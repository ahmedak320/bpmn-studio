import type { CSSProperties, ReactElement } from 'react'

import type {
  BilingualValue,
  FlowOrigin,
  ProcessWorkbookModel,
  WorkbookNode,
  WorkbookParticipant
} from './contracts'

export interface SpreadsheetTopologyPreviewLabels {
  readonly process: string
  readonly node: string
  readonly type: string
  readonly participant: string
  readonly flow: string
  readonly condition: string
  readonly defaultFlow: string
  readonly generated: string
  readonly explicit: string
  readonly mapped: string
  readonly inferred: string
  readonly synthetic: string
  readonly unassigned: string
}

export interface SpreadsheetTopologyPreviewProps {
  readonly model: ProcessWorkbookModel
  readonly labels: SpreadsheetTopologyPreviewLabels
}

interface Position {
  readonly x: number
  readonly y: number
}

const ROW_HEIGHT = 112
const LABEL_WIDTH = 170
const NODE_WIDTH = 118
const NODE_HEIGHT = 54
const NODE_GAP = 52

function displayed(value: BilingualValue): string {
  return value.active === 'ar' ? value.ar || value.en || '' : value.en || value.ar || ''
}

function compareParticipant(left: WorkbookParticipant, right: WorkbookParticipant): number {
  return (
    (left.order ?? Number.POSITIVE_INFINITY) - (right.order ?? Number.POSITIVE_INFINITY) ||
    left.provenance.row - right.provenance.row ||
    left.id.localeCompare(right.id, 'en')
  )
}

function compareNode(left: WorkbookNode, right: WorkbookNode): number {
  return (
    (left.order ?? Number.POSITIVE_INFINITY) - (right.order ?? Number.POSITIVE_INFINITY) ||
    left.provenance.row - right.provenance.row ||
    left.id.localeCompare(right.id, 'en')
  )
}

function membershipId(
  node: WorkbookNode,
  participants: ReadonlyMap<string, WorkbookParticipant>
): string {
  if (node.laneId && participants.has(node.laneId)) return node.laneId
  if (node.participantId && participants.has(node.participantId)) return node.participantId
  if (node.poolId && participants.has(node.poolId)) return node.poolId
  return 'unassigned'
}

function originLabel(origin: FlowOrigin, labels: SpreadsheetTopologyPreviewLabels): string {
  switch (origin) {
    case 'explicit':
      return labels.explicit
    case 'mapped':
      return labels.mapped
    case 'inferred-order':
      return labels.inferred
    case 'synthetic-boundary':
      return labels.synthetic
  }
}

function originColor(origin: FlowOrigin): string {
  switch (origin) {
    case 'explicit':
      return 'var(--orbitpm-muted, #64748b)'
    case 'mapped':
      return 'var(--orbitpm-accent, #2563eb)'
    case 'inferred-order':
      return '#7c3aed'
    case 'synthetic-boundary':
      return '#c2410c'
  }
}

function nodeShape(node: WorkbookNode, x: number, y: number): ReactElement {
  const gateway = node.type.endsWith('Gateway')
  const event = node.type.endsWith('Event')
  if (gateway) {
    const centerX = x + NODE_WIDTH / 2
    const centerY = y + NODE_HEIGHT / 2
    return (
      <polygon
        points={`${centerX},${y} ${x + NODE_WIDTH},${centerY} ${centerX},${
          y + NODE_HEIGHT
        } ${x},${centerY}`}
        style={nodeGlyph}
      />
    )
  }
  if (event) {
    return (
      <ellipse
        cx={x + NODE_WIDTH / 2}
        cy={y + NODE_HEIGHT / 2}
        rx={NODE_WIDTH / 2}
        ry={NODE_HEIGHT / 2}
        style={nodeGlyph}
      />
    )
  }
  return <rect x={x} y={y} width={NODE_WIDTH} height={NODE_HEIGHT} rx={8} style={nodeGlyph} />
}

function markerId(processId: string): string {
  return `spreadsheet-topology-arrow-${processId.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

function pathForEdge(source: Position, target: Position): string {
  const sourceX = source.x + NODE_WIDTH
  const sourceY = source.y + NODE_HEIGHT / 2
  const targetX = target.x
  const targetY = target.y + NODE_HEIGHT / 2
  if (targetX > sourceX) {
    const controlX = sourceX + (targetX - sourceX) / 2
    return `M ${sourceX} ${sourceY} C ${controlX} ${sourceY}, ${controlX} ${targetY}, ${targetX} ${targetY}`
  }
  const detourY = Math.max(16, Math.min(sourceY, targetY) - 42)
  return `M ${sourceX} ${sourceY} C ${sourceX + 36} ${detourY}, ${
    targetX - 36
  } ${detourY}, ${targetX} ${targetY}`
}

export function SpreadsheetTopologyPreview({
  model,
  labels
}: SpreadsheetTopologyPreviewProps): ReactElement {
  return (
    <div style={rootStyle}>
      {model.processes.map((process) => {
        const participants = model.participants
          .filter(({ processId }) => processId === process.id)
          .slice()
          .sort(compareParticipant)
        const participantById = new Map(participants.map((entry) => [entry.id, entry]))
        const nodes = model.nodes
          .filter(({ processId }) => processId === process.id)
          .slice()
          .sort(compareNode)
        const flows = model.flows.filter(({ processId }) => processId === process.id)
        const rowIds = [...participants.map(({ id }) => id), 'unassigned']
        const usedRowIds = new Set(nodes.map((node) => membershipId(node, participantById)))
        const visibleRows = rowIds.filter(
          (id) => id !== 'unassigned' || usedRowIds.has('unassigned') || participants.length === 0
        )
        const rowIndex = new Map(visibleRows.map((id, index) => [id, index]))
        const positions = new Map(
          nodes.map((node, index) => {
            const membership = membershipId(node, participantById)
            return [
              node.id,
              {
                x: LABEL_WIDTH + 24 + index * (NODE_WIDTH + NODE_GAP),
                y: (rowIndex.get(membership) ?? 0) * ROW_HEIGHT + 29
              }
            ] as const
          })
        )
        const width = Math.max(720, LABEL_WIDTH + 48 + nodes.length * (NODE_WIDTH + NODE_GAP))
        const height = Math.max(ROW_HEIGHT, visibleRows.length * ROW_HEIGHT)
        const syntheticNodeIds = new Set(
          flows
            .filter(({ origin }) => origin === 'synthetic-boundary')
            .flatMap(({ sourceStepId, targetStepId }) => [sourceStepId, targetStepId])
        )
        const arrowId = markerId(process.id)

        return (
          <section key={process.id} style={processStyle} aria-labelledby={`${arrowId}-title`}>
            <h5 id={`${arrowId}-title`} style={headingStyle}>
              {labels.process}: <span dir="auto">{displayed(process.name)}</span>{' '}
              <code>{process.id}</code>
            </h5>

            {participants.length > 0 && (
              <ul style={participantList}>
                {participants.map((participant) => (
                  <li key={participant.id} style={participantBadge}>
                    <strong>
                      {participant.type === 'pool' ? '▣' : '▤'} {displayed(participant.name)}
                    </strong>
                    <code>{participant.id}</code>
                    {participant.parentId && <span>↳ {participant.parentId}</span>}
                  </li>
                ))}
              </ul>
            )}

            <div style={svgScroller}>
              <svg
                viewBox={`0 0 ${width} ${height}`}
                width={width}
                height={height}
                role="img"
                aria-label={`${labels.process} ${displayed(process.name)}: ${nodes.length} ${labels.node}, ${flows.length} ${labels.flow}`}
                data-testid={`topology-${process.id}`}
                style={svgStyle}
              >
                <title>
                  {displayed(process.name)} — {nodes.length} {labels.node}, {flows.length}{' '}
                  {labels.flow}
                </title>
                <defs>
                  <marker
                    id={arrowId}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--orbitpm-muted, #64748b)" />
                  </marker>
                </defs>

                {visibleRows.map((id, index) => {
                  const participant = participantById.get(id)
                  const y = index * ROW_HEIGHT
                  return (
                    <g key={id} data-testid={`topology-row-${process.id}-${id}`}>
                      <rect
                        x={0}
                        y={y}
                        width={width}
                        height={ROW_HEIGHT}
                        fill={
                          participant?.type === 'pool'
                            ? 'rgba(37, 99, 235, 0.055)'
                            : index % 2 === 0
                              ? 'rgba(127, 127, 127, 0.035)'
                              : 'transparent'
                        }
                        stroke="var(--orbitpm-border, #cbd5e1)"
                      />
                      <text x={12} y={y + 43} style={rowLabel}>
                        {participant ? displayed(participant.name) : labels.unassigned}
                      </text>
                      <text x={12} y={y + 64} style={rowCode}>
                        {participant?.id ?? ''}
                      </text>
                    </g>
                  )
                })}

                {flows.map((flow) => {
                  const source = positions.get(flow.sourceStepId)
                  const target = positions.get(flow.targetStepId)
                  if (!source || !target) return null
                  const midpointX = (source.x + target.x + NODE_WIDTH) / 2
                  const midpointY = (source.y + target.y + NODE_HEIGHT) / 2
                  return (
                    <g
                      key={flow.id}
                      data-testid={`topology-edge-${flow.id}`}
                      data-origin={flow.origin}
                      data-default={flow.isDefault ? 'true' : 'false'}
                    >
                      <path
                        d={pathForEdge(source, target)}
                        fill="none"
                        stroke={originColor(flow.origin)}
                        strokeWidth={flow.isDefault ? 2.5 : 1.8}
                        strokeDasharray={flow.origin === 'explicit' ? undefined : '7 5'}
                        markerEnd={`url(#${arrowId})`}
                      />
                      {(flow.isDefault || flow.condition) && (
                        <text x={midpointX} y={midpointY - 7} textAnchor="middle" style={edgeLabel}>
                          {flow.isDefault ? '★ ' : ''}
                          {flow.condition ? displayed(flow.condition) : ''}
                        </text>
                      )}
                    </g>
                  )
                })}

                {nodes.map((node) => {
                  const position = positions.get(node.id)!
                  const name = displayed(node.name)
                  const synthetic = syntheticNodeIds.has(node.id)
                  return (
                    <g
                      key={node.id}
                      data-testid={`topology-node-${node.id}`}
                      data-generated={node.idOrigin === 'generated' ? 'true' : 'false'}
                      data-synthetic={synthetic ? 'true' : 'false'}
                    >
                      <title>
                        {name} ({node.id}, {node.type})
                      </title>
                      {nodeShape(node, position.x, position.y)}
                      <text
                        x={position.x + NODE_WIDTH / 2}
                        y={position.y + 23}
                        textAnchor="middle"
                        style={nodeLabel}
                      >
                        {name.length > 17 ? `${name.slice(0, 16)}…` : name}
                      </text>
                      <text
                        x={position.x + NODE_WIDTH / 2}
                        y={position.y + 41}
                        textAnchor="middle"
                        style={nodeCode}
                      >
                        {node.type}
                      </text>
                      {(node.idOrigin === 'generated' || synthetic) && (
                        <text
                          x={position.x + NODE_WIDTH - 4}
                          y={position.y + 10}
                          textAnchor="end"
                          style={markerLabel}
                        >
                          {synthetic ? 'S' : 'G'}
                        </text>
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>

            <div style={detailsGrid}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th>{labels.node}</th>
                    <th>{labels.type}</th>
                    <th>{labels.participant}</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((node) => {
                    const membership = participantById.get(membershipId(node, participantById))
                    return (
                      <tr key={node.id}>
                        <td>
                          <span dir="auto">{displayed(node.name)}</span> <code>{node.id}</code>
                          {node.idOrigin === 'generated' && (
                            <small style={tagStyle}>{labels.generated}</small>
                          )}
                          {syntheticNodeIds.has(node.id) && (
                            <small style={tagStyle}>{labels.synthetic}</small>
                          )}
                        </td>
                        <td>
                          <code>{node.type}</code>
                        </td>
                        <td>
                          {membership ? (
                            <>
                              <span dir="auto">{displayed(membership.name)}</span>{' '}
                              <code>{membership.id}</code>
                            </>
                          ) : (
                            labels.unassigned
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <ol style={flowList}>
                {flows.map((flow) => (
                  <li key={flow.id} style={flowItem}>
                    <code>{flow.sourceStepId}</code> → <code>{flow.targetStepId}</code>
                    <span style={tagStyle}>{originLabel(flow.origin, labels)}</span>
                    {flow.isDefault && <strong style={tagStyle}>{labels.defaultFlow}</strong>}
                    {flow.condition && (
                      <span dir="auto">
                        {labels.condition}: {displayed(flow.condition)}
                      </span>
                    )}
                    <small>
                      {labels.flow}: <code>{flow.id}</code>
                    </small>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )
      })}
    </div>
  )
}

const rootStyle: CSSProperties = {
  display: 'grid',
  gap: 12
}

const processStyle: CSSProperties = {
  display: 'grid',
  gap: 9,
  minWidth: 0,
  padding: 9,
  border: '1px solid var(--orbitpm-border, #cbd5e1)',
  borderRadius: 8
}

const headingStyle: CSSProperties = {
  margin: 0,
  overflowWrap: 'anywhere'
}

const participantList: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  listStyle: 'none',
  padding: 0,
  margin: 0
}

const participantBadge: CSSProperties = {
  display: 'flex',
  gap: 5,
  alignItems: 'baseline',
  padding: '4px 6px',
  border: '1px solid var(--orbitpm-border, #cbd5e1)',
  borderRadius: 6,
  fontSize: 11
}

const svgScroller: CSSProperties = {
  maxWidth: '100%',
  overflow: 'auto',
  borderRadius: 6,
  border: '1px solid var(--orbitpm-border, #cbd5e1)'
}

const svgStyle: CSSProperties = {
  display: 'block',
  maxHeight: 520,
  background: 'var(--orbitpm-surface, #fff)'
}

const rowLabel: CSSProperties = {
  fill: 'var(--orbitpm-text, #0f172a)',
  fontSize: 12,
  fontWeight: 650
}

const rowCode: CSSProperties = {
  fill: 'var(--orbitpm-muted, #64748b)',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 10
}

const nodeGlyph: CSSProperties = {
  fill: 'var(--orbitpm-surface, #fff)',
  stroke: 'var(--orbitpm-text, #334155)',
  strokeWidth: 1.6
}

const nodeLabel: CSSProperties = {
  fill: 'var(--orbitpm-text, #0f172a)',
  fontSize: 10.5,
  fontWeight: 650
}

const nodeCode: CSSProperties = {
  fill: 'var(--orbitpm-muted, #64748b)',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 8.5
}

const edgeLabel: CSSProperties = {
  fill: 'var(--orbitpm-text, #0f172a)',
  fontSize: 9,
  paintOrder: 'stroke',
  stroke: 'var(--orbitpm-surface, #fff)',
  strokeWidth: 3
}

const markerLabel: CSSProperties = {
  fill: '#c2410c',
  fontSize: 9,
  fontWeight: 800
}

const detailsGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(360px, 1.25fr) minmax(260px, 1fr)',
  gap: 10,
  overflow: 'auto'
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 11,
  textAlign: 'start'
}

const flowList: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: 6,
  margin: 0,
  paddingInlineStart: 24,
  fontSize: 11
}

const flowItem: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 5,
  alignItems: 'baseline',
  overflowWrap: 'anywhere'
}

const tagStyle: CSSProperties = {
  display: 'inline-block',
  marginInlineStart: 5,
  padding: '1px 4px',
  border: '1px solid currentColor',
  borderRadius: 999,
  fontSize: 9.5
}
