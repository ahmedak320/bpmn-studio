/**
 * Structural gate for AML files emitted by the DMT supportive-blocks convention.
 *
 * Run: node_modules/.bin/vite-node scripts/dmt-aml-verify.ts file.aml [...more.aml]
 */
import { readFileSync } from 'node:fs'
import { buildFromSource } from '../src/aris/model/buildFromSource'
import { buildSemanticArisDocument } from '../src/aris/source/semanticIndex'
import {
  tokenizeXmlDocument,
  type TokenizedXmlDocument,
  type XmlElementNode
} from '../src/aris/source/xmlTokenizer'

const LEGEND_PREFIX = 'ObjOcc.dl:'
const LEGEND_HEADER_ID = 'FFTextDef.legend.defaults'
const LEGEND_WIDTH = 180
const LEGEND_HEIGHT = 70
const LEGEND_HEADER_BAND = 56
const LEGEND_BLOCK_STEP = 110
const CLUSTER_DISTANCE_LIMIT = 1.5 * (180 + 28)

const LEGEND_ID = /^ObjOcc\.dl:(owner|system|informationObject|control):([^:]+)$/u
const DUPLICATE_DEFINITION_ID = /^ObjDef\.(r|s|io|c):([^@]+)@(.+)$/u

type DefaultKind = 'owner' | 'system' | 'informationObject' | 'control'
type CheckName = 'defaults' | 'suppressed' | 'proximity' | 'integer' | 'fftext'

interface CheckResult {
  readonly name: CheckName
  readonly failures: readonly string[]
}

interface FileResult {
  readonly file: string
  readonly checks: readonly CheckResult[]
  readonly parseFailure: string | null
}

interface LegendBlock {
  readonly id: string
  readonly kind: DefaultKind
  readonly entityId: string
  readonly definitionId: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const PREFIX_BY_KIND: Readonly<Record<DefaultKind, string>> = Object.freeze({
  owner: 'r',
  system: 's',
  informationObject: 'io',
  control: 'c'
})

const SATELLITE_TYPES = new Set([
  'OT_PERS_TYPE',
  'OT_PERS',
  'OT_POS',
  'OT_ORG_UNIT',
  'OT_GRP',
  'OT_APPL_SYS',
  'OT_SERVICE',
  'OT_INFO_CARR',
  'OT_POLICY',
  'OT_BUSINESS_RULE',
  'OT_REQUIREMENT',
  'OT_RISK'
])

function elementNodes(document: TokenizedXmlDocument): XmlElementNode[] {
  const elements: XmlElementNode[] = []
  const visit = (nodes: readonly { readonly kind: string }[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'element') continue
      const element = node as XmlElementNode
      elements.push(element)
      visit(element.children)
    }
  }
  visit(document.children)
  return elements
}

function attribute(element: XmlElementNode, name: string): string | null {
  return element.startTag.attributes.find((candidate) => candidate.name === name)?.value ?? null
}

function directElements(element: XmlElementNode): readonly XmlElementNode[] {
  return element.children.filter((node): node is XmlElementNode => node.kind === 'element')
}

function isIntegerCoordinate(value: string | null): boolean {
  if (value === null || value.trim() === '') return false
  const parsed = Number(value)
  return Number.isFinite(parsed) && Number.isInteger(parsed)
}

function isTypeForKind(type: string, kind: DefaultKind): boolean {
  switch (kind) {
    case 'owner':
      return ['OT_PERS_TYPE', 'OT_PERS', 'OT_POS', 'OT_ORG_UNIT', 'OT_GRP'].includes(type)
    case 'system':
      return type === 'OT_APPL_SYS' || type === 'OT_SERVICE'
    case 'informationObject':
      return type === 'OT_INFO_CARR'
    case 'control':
      return ['OT_POLICY', 'OT_BUSINESS_RULE', 'OT_REQUIREMENT', 'OT_RISK'].includes(type)
  }
}

function checkIntegerPositions(document: TokenizedXmlDocument): CheckResult {
  const failures: string[] = []
  for (const token of document.tokens) {
    if ((token.kind !== 'start-tag' && token.kind !== 'empty-tag') || !['Position', 'Size'].includes(token.name))
      continue
    const names = token.name === 'Position' ? ['Pos.X', 'Pos.Y'] : ['Size.dX', 'Size.dY']
    for (const name of names) {
      const value = token.attributes.find((candidate) => candidate.name === name)?.value ?? null
      if (!isIntegerCoordinate(value)) failures.push(`${token.name}.${name}=${value ?? '<missing>'}`)
    }
  }
  return { name: 'integer', failures }
}

function checkFreeText(document: TokenizedXmlDocument): CheckResult {
  const elements = elementNodes(document)
  const definitions = elements.filter((element) => element.name === 'FFTextDef')
  const occurrences = elements.filter((element) => element.name === 'FFTextOcc')
  const failures: string[] = []
  if (definitions.length !== 1)
    failures.push(`expected exactly 1 FFTextDef, found ${definitions.length}`)
  else if (attribute(definitions[0] as XmlElementNode, 'FFTextDef.ID') !== LEGEND_HEADER_ID)
    failures.push(`FFTextDef id is not ${LEGEND_HEADER_ID}`)
  if (occurrences.length !== 1)
    failures.push(`expected exactly 1 FFTextOcc, found ${occurrences.length}`)
  else {
    const occurrence = occurrences[0] as XmlElementNode
    if (attribute(occurrence, 'FFTextDef.IdRef') !== LEGEND_HEADER_ID)
      failures.push(`FFTextOcc does not reference ${LEGEND_HEADER_ID}`)
    if (directElements(occurrence).some((child) => child.name === 'Size'))
      failures.push('FFTextOcc has a Size element')
  }
  return { name: 'fftext', failures }
}

function verifyDocument(file: string, xml: string): FileResult {
  try {
    const tokenized = tokenizeXmlDocument(xml)
    const semantic = buildSemanticArisDocument(tokenized)
    const document = buildFromSource(semantic.index)
    const occurrences = [...document.models.values()].flatMap((model) => model.occurrences)
    const connections = [...document.models.values()].flatMap((model) => model.connectionOccurrences)
    const occurrenceById = new Map(occurrences.map((occurrence) => [occurrence.id, occurrence]))
    const definitionTypeByOccurrence = new Map(
      occurrences.map((occurrence) => [
        occurrence.id,
        document.objectDefinitions.get(occurrence.definitionId)?.type ?? ''
      ])
    )
    const incidentByOccurrence = new Map<string, typeof connections>()
    for (const connection of connections) {
      for (const occurrenceId of [connection.sourceOccurrenceId, connection.targetOccurrenceId]) {
        const incident = incidentByOccurrence.get(occurrenceId) ?? []
        incident.push(connection)
        incidentByOccurrence.set(occurrenceId, incident)
      }
    }

    const defaultsFailures: string[] = []
    const legendBlocks: LegendBlock[] = []
    for (const occurrence of occurrences.filter((item) => item.id.startsWith(LEGEND_PREFIX))) {
      const match = LEGEND_ID.exec(occurrence.id)
      if (!match) {
        defaultsFailures.push(`${occurrence.id}: invalid legend id`)
        continue
      }
      const kind = match[1] as DefaultKind
      const entityId = match[2] as string
      legendBlocks.push({
        id: occurrence.id,
        kind,
        entityId,
        definitionId: occurrence.definitionId,
        x: occurrence.bounds.x,
        y: occurrence.bounds.y,
        width: occurrence.bounds.width,
        height: occurrence.bounds.height
      })
      const type = definitionTypeByOccurrence.get(occurrence.id) ?? ''
      if (!isTypeForKind(type, kind)) defaultsFailures.push(`${occurrence.id}: ${type} is not ${kind}`)
      if ((incidentByOccurrence.get(occurrence.id) ?? []).length !== 0)
        defaultsFailures.push(`${occurrence.id}: legend block has incident connections`)
    }
    const kinds = new Map<DefaultKind, LegendBlock[]>()
    for (const block of legendBlocks) {
      const entries = kinds.get(block.kind) ?? []
      entries.push(block)
      kinds.set(block.kind, entries)
    }
    for (const [kind, blocks] of kinds) {
      if (blocks.length !== 1) defaultsFailures.push(`${kind}: expected 1 default block, found ${blocks.length}`)
    }
    const flowOccurrences = occurrences.filter((occurrence) => {
      const type = definitionTypeByOccurrence.get(occurrence.id)
      return type === 'OT_FUNC' || type === 'OT_EVT'
    })
    if (flowOccurrences.length === 0) defaultsFailures.push('no function/event control-flow occurrences')
    const maximumFlowRight = Math.max(...flowOccurrences.map((item) => item.bounds.x + item.bounds.width))
    const headerOccurrence = semantic.index.freeTextOccurrences.find(
      (occurrence) => occurrence.parsed.freeTextDefinitionId === LEGEND_HEADER_ID
    )
    const headerX = headerOccurrence?.parsed.x ?? Number.NaN
    const headerY = headerOccurrence?.parsed.y ?? Number.NaN
    const sortedLegend = [...legendBlocks].sort((a, b) => a.y - b.y || a.kind.localeCompare(b.kind))
    for (const [index, block] of sortedLegend.entries()) {
      if (block.width !== LEGEND_WIDTH || block.height !== LEGEND_HEIGHT)
        defaultsFailures.push(`${block.id}: expected ${LEGEND_WIDTH}x${LEGEND_HEIGHT}, found ${block.width}x${block.height}`)
      if (!(block.x > maximumFlowRight))
        defaultsFailures.push(`${block.id}: x=${block.x} is not right of flow edge ${maximumFlowRight}`)
      if (block.x !== headerX) defaultsFailures.push(`${block.id}: x=${block.x} differs from header x=${headerX}`)
      const expectedY = headerY + LEGEND_HEADER_BAND + index * LEGEND_BLOCK_STEP
      if (block.y !== expectedY)
        defaultsFailures.push(`${block.id}: y=${block.y}, expected stacked y=${expectedY}`)
    }

    const suppressedFailures: string[] = []
    for (const block of legendBlocks) {
      if (!document.objectDefinitions.has(block.definitionId))
        suppressedFailures.push(`${block.id}: referenced ObjDef ${block.definitionId} is absent`)
      const prefix = PREFIX_BY_KIND[block.kind]
      const duplicateDefinitions = [...document.objectDefinitions.values()].filter((definition) => {
        const match = DUPLICATE_DEFINITION_ID.exec(definition.id)
        return match?.[1] === prefix && match[2] === block.entityId
      })
      for (const definition of duplicateDefinitions) {
        const match = DUPLICATE_DEFINITION_ID.exec(definition.id)
        if (!match) continue
        const ownerOccurrenceId = `ObjOcc.n:${match[3]}`
        const owner = occurrenceById.get(ownerOccurrenceId)
        if (!owner || definitionTypeByOccurrence.get(ownerOccurrenceId) !== 'OT_FUNC') {
          suppressedFailures.push(`${definition.id}: no owning function ${ownerOccurrenceId}`)
          continue
        }
        const duplicateOccurrenceId = definition.id.replace(/^ObjDef\./u, 'ObjOcc.')
        const hasOverride = (incidentByOccurrence.get(ownerOccurrenceId) ?? []).some((connection) => {
          const otherId =
            connection.sourceOccurrenceId === ownerOccurrenceId
              ? connection.targetOccurrenceId
              : connection.sourceOccurrenceId
          return (
            otherId !== duplicateOccurrenceId &&
            otherId.startsWith('ObjOcc.') &&
            isTypeForKind(definitionTypeByOccurrence.get(otherId) ?? '', block.kind)
          )
        })
        if (!hasOverride && occurrenceById.has(duplicateOccurrenceId))
          suppressedFailures.push(`${duplicateOccurrenceId}: suppressed default duplicate is present`)
      }
    }

    const proximityFailures: string[] = []
    for (const occurrence of occurrences) {
      if (occurrence.id.startsWith(LEGEND_PREFIX)) continue
      if (!SATELLITE_TYPES.has(definitionTypeByOccurrence.get(occurrence.id) ?? '')) continue
      const incident = incidentByOccurrence.get(occurrence.id) ?? []
      // A per-step satellite occurrence may carry more than one tether to the
      // SAME owner (e.g. an information carrier a step both reads and creates —
      // an input CT plus an output CT). That is a legitimate local cluster, not
      // the prohibited SHARED fan-out. The real "no fan-out" invariant is that
      // every incident connection reaches ONE owner occurrence.
      if (incident.length === 0) {
        proximityFailures.push(`${occurrence.id}: expected >=1 incident connection, found 0`)
        continue
      }
      const ownerIds = new Set(
        incident.map((connection) =>
          connection.sourceOccurrenceId === occurrence.id
            ? connection.targetOccurrenceId
            : connection.sourceOccurrenceId
        )
      )
      if (ownerIds.size !== 1) {
        proximityFailures.push(
          `${occurrence.id}: fan-out across ${ownerIds.size} owners (${[...ownerIds].join(', ')})`
        )
        continue
      }
      const ownerId = [...ownerIds][0] as string
      const owner = occurrenceById.get(ownerId)
      if (!owner || definitionTypeByOccurrence.get(ownerId) !== 'OT_FUNC') {
        proximityFailures.push(`${occurrence.id}: connection does not reach a function (${ownerId})`)
        continue
      }
      const dx = occurrence.bounds.x + occurrence.bounds.width / 2 - (owner.bounds.x + owner.bounds.width / 2)
      const dy = occurrence.bounds.y + occurrence.bounds.height / 2 - (owner.bounds.y + owner.bounds.height / 2)
      const distance = Math.hypot(dx, dy)
      if (!(distance < CLUSTER_DISTANCE_LIMIT))
        proximityFailures.push(
          `${occurrence.id}: center distance ${distance.toFixed(1)} exceeds ${CLUSTER_DISTANCE_LIMIT}`
        )
    }

    return {
      file,
      parseFailure: null,
      checks: [
        { name: 'defaults', failures: defaultsFailures },
        { name: 'suppressed', failures: suppressedFailures },
        { name: 'proximity', failures: proximityFailures },
        checkIntegerPositions(tokenized),
        checkFreeText(tokenized)
      ]
    }
  } catch (error) {
    return {
      file,
      parseFailure: error instanceof Error ? error.message : String(error),
      checks: []
    }
  }
}

function printResult(results: readonly FileResult[]): void {
  console.table(
    results.map((result) => {
      const statuses = Object.fromEntries(
        result.checks.map((check) => [check.name, check.failures.length === 0 ? 'PASS' : 'FAIL'])
      )
      return {
        file: result.file,
        parse: result.parseFailure === null ? 'PASS' : 'FAIL',
        defaults: statuses.defaults ?? 'FAIL',
        suppressed: statuses.suppressed ?? 'FAIL',
        proximity: statuses.proximity ?? 'FAIL',
        integer: statuses.integer ?? 'FAIL',
        fftext: statuses.fftext ?? 'FAIL',
        result:
          result.parseFailure === null && result.checks.every((check) => check.failures.length === 0)
            ? 'PASS'
            : 'FAIL'
      }
    })
  )
  for (const result of results) {
    if (result.parseFailure !== null) {
      console.error(`${result.file}: parse failure: ${result.parseFailure}`)
      continue
    }
    for (const check of result.checks) {
      for (const failure of check.failures) console.error(`${result.file}: ${check.name}: ${failure}`)
    }
  }
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  if (argv.length === 0) {
    console.error('Usage: vite-node scripts/dmt-aml-verify.ts <file.aml> [...file.aml]')
    process.exit(1)
  }
  const results = argv.map((file) => {
    try {
      return verifyDocument(file, readFileSync(file, 'utf8'))
    } catch (error) {
      return {
        file,
        parseFailure: error instanceof Error ? error.message : String(error),
        checks: []
      }
    }
  })
  printResult(results)
  if (
    results.some(
      (result) => result.parseFailure !== null || result.checks.some((check) => check.failures.length > 0)
    )
  ) process.exit(1)
}

main()
