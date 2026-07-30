import { conventionDefaultFill } from '../conventions/catalog'
import type {
  ArisBounds,
  ArisDrawingElement,
  ArisPort,
  ArisSymbolDescriptor,
  ArisSymbolDrawing,
  ArisViewBox
} from './types'

const DEFAULT_STROKE = '#1a1a1a'
const DEFAULT_FILL = '#ffffff'

function viewBox(width: number, height: number): ArisViewBox {
  return { minX: 0, minY: 0, width, height }
}

/**
 * The descriptor's body fill: the DMT ARIS convention default for this
 * objectType/symbolNum (plan R1, `conventions/catalog.ts`). Falls back to the
 * original OrbitPM line-art tone only if the catalog somehow has no entry for
 * a key every descriptor below is registered against.
 */
function bodyFill(objectType: string, symbolNum: string, fallback: string): string {
  return conventionDefaultFill(objectType, symbolNum) ?? fallback
}

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  options: { rx?: number; ry?: number; fill?: string; stroke?: string; strokeWidth?: number } = {}
): ArisDrawingElement {
  return {
    kind: 'rect',
    x,
    y,
    width,
    height,
    rx: options.rx,
    ry: options.ry,
    fill: options.fill ?? DEFAULT_FILL,
    stroke: options.stroke ?? DEFAULT_STROKE,
    strokeWidth: options.strokeWidth ?? 2
  }
}

function circle(
  cx: number,
  cy: number,
  r: number,
  options: { fill?: string; stroke?: string; strokeWidth?: number } = {}
): ArisDrawingElement {
  return {
    kind: 'circle',
    cx,
    cy,
    r,
    fill: options.fill ?? DEFAULT_FILL,
    stroke: options.stroke ?? DEFAULT_STROKE,
    strokeWidth: options.strokeWidth ?? 2
  }
}

function path(
  d: string,
  options: { fill?: string; stroke?: string; strokeWidth?: number } = {}
): ArisDrawingElement {
  return {
    kind: 'path',
    d,
    fill: options.fill ?? 'none',
    stroke: options.stroke ?? DEFAULT_STROKE,
    strokeWidth: options.strokeWidth ?? 2
  }
}

function polygon(
  points: readonly { x: number; y: number }[],
  options: { fill?: string; stroke?: string; strokeWidth?: number } = {}
): ArisDrawingElement {
  return {
    kind: 'polygon',
    points,
    fill: options.fill ?? DEFAULT_FILL,
    stroke: options.stroke ?? DEFAULT_STROKE,
    strokeWidth: options.strokeWidth ?? 2
  }
}

function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  options: { stroke?: string; strokeWidth?: number } = {}
): ArisDrawingElement {
  return {
    kind: 'line',
    x1,
    y1,
    x2,
    y2,
    stroke: options.stroke ?? DEFAULT_STROKE,
    strokeWidth: options.strokeWidth ?? 2
  }
}

/** Cardinal and intercardinal attachment ports for rectangular/circular symbols. */
function standardPorts(): readonly ArisPort[] {
  return [
    { name: 'NW', nx: 0, ny: 0 },
    { name: 'N', nx: 0.5, ny: 0 },
    { name: 'NE', nx: 1, ny: 0 },
    { name: 'E', nx: 1, ny: 0.5 },
    { name: 'SE', nx: 1, ny: 1 },
    { name: 'S', nx: 0.5, ny: 1 },
    { name: 'SW', nx: 0, ny: 1 },
    { name: 'W', nx: 0, ny: 0.5 },
    { name: 'CENTER', nx: 0.5, ny: 0.5 }
  ]
}

function describe(
  key: string,
  objectType: string,
  symbolNum: string,
  labelKey: string,
  bounds: ArisBounds,
  drawing: ArisSymbolDrawing,
  ports: readonly ArisPort[] = standardPorts()
): ArisSymbolDescriptor {
  return Object.freeze({
    key,
    objectType,
    symbolNum,
    labelKey,
    defaultBounds: Object.freeze(bounds),
    ports: Object.freeze(ports),
    drawing: Object.freeze(drawing)
  })
}

// ---------------------------------------------------------------------------
// Core EPC symbols — original geometry, no proprietary artwork.
// ---------------------------------------------------------------------------

function functionShape(
  variant: 'plain' | 'interface' | 'system' | 'value-chain'
): ArisSymbolDescriptor {
  const baseKey =
    variant === 'interface'
      ? 'ST_PRCS_IF'
      : variant === 'system'
        ? 'ST_SYS_FUNC_ACT'
        : variant === 'value-chain'
          ? 'ST_VAL_ADD_CHN_SML_1'
          : 'ST_FUNC'
  const labelKey =
    variant === 'interface'
      ? 'aris.symbol.processInterface'
      : variant === 'system'
        ? 'aris.symbol.systemFunction'
        : variant === 'value-chain'
          ? 'aris.symbol.valueAddedChain'
          : 'aris.symbol.function'
  const objectType = variant === 'value-chain' ? 'OT_FUNC' : 'OT_FUNC'
  const modelType = variant === 'value-chain' ? 'MT_VAL_ADD_CHN_DGM' : 'MT_EEPC'
  const key = `${modelType}:${objectType}:${baseKey}`
  const fill = bodyFill(objectType, baseKey, '#339900')

  const elements: ArisDrawingElement[] = []

  if (variant === 'value-chain') {
    // A right-pointing chevron/banner — the original line-art take on the
    // Value-Added Chain Diagram's arrow-shaped elements (plan R1, "VACD start
    // chevron"; the mid-chain and start symbols share one SymbolNum, so one
    // descriptor draws both).
    elements.push(
      polygon(
        [
          { x: 5, y: 15 },
          { x: 75, y: 15 },
          { x: 92, y: 30 },
          { x: 75, y: 45 },
          { x: 5, y: 45 },
          { x: 20, y: 30 }
        ],
        { fill }
      )
    )
  } else {
    elements.push(rect(5, 10, 90, 50, { rx: 12, ry: 12, fill }))
  }

  if (variant === 'interface') {
    elements.push(line(22, 10, 22, 60, { strokeWidth: 3 }))
    elements.push(line(78, 10, 78, 60, { strokeWidth: 3 }))
  }

  if (variant === 'system') {
    // Small gear-like cog centered in the function.
    const cx = 50
    const cy = 35
    const outer = 12
    const inner = 7
    let d = ''
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4
      const aMid = a + Math.PI / 8
      const x1 = cx + outer * Math.cos(a)
      const y1 = cy + outer * Math.sin(a)
      const x2 = cx + outer * Math.cos(aMid)
      const y2 = cy + outer * Math.sin(aMid)
      const x3 = cx + inner * Math.cos(aMid)
      const y3 = cy + inner * Math.sin(aMid)
      d += `${i === 0 ? 'M' : 'L'} ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} `
    }
    d += 'Z'
    elements.push(path(d, { fill: '#d1d5db' }))
    elements.push(circle(cx, cy, 4, { fill: '#9ca3af' }))
  }

  return describe(
    key,
    objectType,
    baseKey,
    labelKey,
    { width: 100, height: 70 },
    { viewBox: viewBox(100, 70), elements }
  )
}

function eventShape(): ArisSymbolDescriptor {
  const fill = bodyFill('OT_EVT', 'ST_EV', '#dcbbed')
  const elements: ArisDrawingElement[] = [
    polygon(
      [
        { x: 15, y: 50 },
        { x: 32, y: 8 },
        { x: 68, y: 8 },
        { x: 85, y: 50 },
        { x: 68, y: 92 },
        { x: 32, y: 92 }
      ],
      { fill }
    )
  ]
  return describe(
    'MT_EEPC:OT_EVT:ST_EV',
    'OT_EVT',
    'ST_EV',
    'aris.symbol.event',
    { width: 100, height: 100 },
    { viewBox: viewBox(100, 100), elements }
  )
}

function ruleShape(operator: 'and' | 'or' | 'xor'): ArisSymbolDescriptor {
  const symbolNum =
    operator === 'and' ? 'ST_OPR_AND_1' : operator === 'or' ? 'ST_OPR_OR_1' : 'ST_OPR_XOR_1'
  const labelKey =
    operator === 'and'
      ? 'aris.symbol.and'
      : operator === 'or'
        ? 'aris.symbol.or'
        : 'aris.symbol.xor'
  const fill = bodyFill('OT_RULE', symbolNum, '#d5d5f7')
  const elements: ArisDrawingElement[] = [circle(50, 50, 40, { fill })]

  if (operator === 'and') {
    // Ampersand-like squiggle drawn from original path geometry.
    elements.push(
      path(
        'M 38 38 C 38 30, 46 30, 46 38 C 46 44, 38 52, 38 60 C 38 70, 52 70, 54 60 C 56 50, 40 42, 40 42',
        { strokeWidth: 3 }
      )
    )
  } else if (operator === 'or') {
    // "≥1" approximation using original path strokes.
    elements.push(path('M 34 42 L 46 50 L 34 58', { strokeWidth: 3 }))
    elements.push(line(50, 38, 50, 62, { strokeWidth: 3 }))
  } else {
    // XOR: diagonal cross.
    elements.push(line(34, 34, 66, 66, { strokeWidth: 3 }))
    elements.push(line(66, 34, 34, 66, { strokeWidth: 3 }))
  }

  return describe(
    `MT_EEPC:OT_RULE:${symbolNum}`,
    'OT_RULE',
    symbolNum,
    labelKey,
    { width: 80, height: 80 },
    { viewBox: viewBox(100, 100), elements }
  )
}

function entityTypeShape(): ArisSymbolDescriptor {
  const fill = bodyFill('OT_ENT_TYPE', 'ST_ENT_TYPE', '#b6dce9')
  return describe(
    'MT_EEPC:OT_ENT_TYPE:ST_ENT_TYPE',
    'OT_ENT_TYPE',
    'ST_ENT_TYPE',
    'aris.symbol.entityType',
    { width: 100, height: 70 },
    {
      viewBox: viewBox(100, 70),
      elements: [
        rect(5, 5, 90, 60, { rx: 6, ry: 6, fill }),
        line(28, 5, 28, 65, { strokeWidth: 4 })
      ]
    }
  )
}

function infoCarrierShape(
  variant: 'document' | 'email' | 'edoc' | 'handy' | 'letter' | 'log' | 'general'
): ArisSymbolDescriptor {
  const symbolNum =
    variant === 'email'
      ? 'ST_EMAIL_1'
      : variant === 'edoc'
        ? 'ST_INFO_CARR_EDOC'
        : variant === 'handy'
          ? 'ST_INFO_CARR_HANDY'
          : variant === 'letter'
            ? 'ST_LETTER'
            : variant === 'log'
              ? 'ST_LOG'
              : variant === 'general'
                ? 'ST_INFO_CARR_1'
                : 'ST_DOC'
  const labelKey =
    variant === 'email'
      ? 'aris.symbol.email'
      : variant === 'edoc'
        ? 'aris.symbol.eDocument'
        : variant === 'handy'
          ? 'aris.symbol.mobile'
          : variant === 'letter'
            ? 'aris.symbol.letter'
            : variant === 'log'
              ? 'aris.symbol.log'
              : variant === 'general'
                ? 'aris.symbol.infoCarrier'
                : 'aris.symbol.document'
  const fill = bodyFill('OT_INFO_CARR', symbolNum, '#cccccc')
  const elements: ArisDrawingElement[] = []

  if (variant === 'email') {
    elements.push(rect(5, 20, 90, 60, { rx: 4, ry: 4, fill }))
    elements.push(path('M 5 20 L 50 55 L 95 20', { fill: 'none' }))
  } else if (variant === 'handy') {
    elements.push(rect(35, 10, 30, 70, { rx: 6, ry: 6, fill }))
    elements.push(line(50, 5, 50, 15, { strokeWidth: 3 }))
    elements.push(circle(50, 75, 5, { fill: '#c4b5fd' }))
  } else if (variant === 'letter') {
    // A written page: ruled lines plus a wax-seal accent, distinct from the
    // envelope (email) and ledger (log) variants.
    elements.push(rect(8, 8, 84, 68, { rx: 2, ry: 2, fill }))
    elements.push(line(20, 26, 80, 26, { strokeWidth: 2 }))
    elements.push(line(20, 40, 80, 40, { strokeWidth: 1.5 }))
    elements.push(line(20, 54, 60, 54, { strokeWidth: 1.5 }))
    elements.push(circle(78, 64, 7, { fill: '#fca5a5' }))
  } else if (variant === 'log') {
    // A ledger: evenly spaced rule lines, no fold or seal.
    elements.push(rect(5, 8, 90, 68, { rx: 2, ry: 2, fill }))
    elements.push(line(15, 22, 85, 22, { strokeWidth: 1.5 }))
    elements.push(line(15, 34, 85, 34, { strokeWidth: 1.5 }))
    elements.push(line(15, 46, 85, 46, { strokeWidth: 1.5 }))
    elements.push(line(15, 58, 85, 58, { strokeWidth: 1.5 }))
    elements.push(line(15, 70, 85, 70, { strokeWidth: 1.5 }))
  } else if (variant === 'general') {
    // The generic/parent information carrier: a plain carrier, deliberately
    // undecorated so it reads as the family's base symbol.
    elements.push(rect(5, 8, 90, 68, { rx: 6, ry: 6, fill }))
  } else {
    // Document with folded corner (also the base for the e-file variant).
    elements.push(rect(5, 5, 90, 75, { rx: 4, ry: 4, fill }))
    elements.push(
      polygon([
        { x: 75, y: 5 },
        { x: 95, y: 25 },
        { x: 75, y: 25 }
      ])
    )
    if (variant === 'edoc') {
      elements.push(circle(32, 45, 6, { fill: '#93c5fd' }))
      elements.push(
        path('M 46 38 L 46 52 M 52 38 L 52 52 M 58 38 L 58 52', {
          strokeWidth: 3,
          stroke: '#3b82f6'
        })
      )
    }
  }

  return describe(
    `MT_EEPC:OT_INFO_CARR:${symbolNum}`,
    'OT_INFO_CARR',
    symbolNum,
    labelKey,
    { width: 100, height: 90 },
    { viewBox: viewBox(100, 90), elements }
  )
}

function businessRuleShape(): ArisSymbolDescriptor {
  // Rounded rectangle with a simple balance scale.
  const fill = bodyFill('OT_BUSINESS_RULE', 'ST_BUSINESS_RULE', '#fde047')
  return describe(
    'MT_EEPC:OT_BUSINESS_RULE:ST_BUSINESS_RULE',
    'OT_BUSINESS_RULE',
    'ST_BUSINESS_RULE',
    'aris.symbol.businessRule',
    { width: 100, height: 70 },
    {
      viewBox: viewBox(100, 70),
      elements: [
        rect(5, 5, 90, 60, { rx: 8, ry: 8, fill }),
        line(50, 20, 50, 45, { strokeWidth: 2 }),
        line(30, 30, 70, 30, { strokeWidth: 2 }),
        path('M 28 30 C 24 38, 24 38, 30 38 C 36 38, 36 38, 32 30', { fill: '#ca8a04' }),
        path('M 68 30 C 64 38, 64 38, 70 38 C 76 38, 76 38, 72 30', { fill: '#ca8a04' })
      ]
    }
  )
}

function performanceShape(): ArisSymbolDescriptor {
  // Rounded rectangle with a gauge arc and needle.
  const fill = bodyFill('OT_PERF', 'ST_PERFORM', '#2563eb')
  return describe(
    'MT_EEPC:OT_PERF:ST_PERFORM',
    'OT_PERF',
    'ST_PERFORM',
    'aris.symbol.performance',
    { width: 100, height: 70 },
    {
      viewBox: viewBox(100, 70),
      elements: [
        rect(5, 5, 90, 60, { rx: 8, ry: 8, fill }),
        path('M 25 50 A 25 25 0 0 1 75 50', { fill: 'none', strokeWidth: 3, stroke: '#bfdbfe' }),
        line(50, 50, 62, 32, { strokeWidth: 3, stroke: '#f8fafc' })
      ]
    }
  )
}

function applicationSystemShape(): ArisSymbolDescriptor {
  // Monitor with a stand.
  const fill = bodyFill('OT_APPL_SYS', 'ST_APPL_SYS', '#000099')
  return describe(
    'MT_EEPC:OT_APPL_SYS:ST_APPL_SYS',
    'OT_APPL_SYS',
    'ST_APPL_SYS',
    'aris.symbol.applicationSystem',
    { width: 100, height: 80 },
    {
      viewBox: viewBox(100, 80),
      elements: [
        rect(10, 10, 80, 50, { rx: 4, ry: 4, fill }),
        line(35, 60, 35, 72, { strokeWidth: 3 }),
        line(25, 72, 65, 72, { strokeWidth: 3 }),
        rect(15, 15, 70, 35, { fill: '#cffafe' })
      ]
    }
  )
}

function personShape(external: boolean): ArisSymbolDescriptor {
  const symbolNum = external ? 'ST_PERS_EXT' : 'ST_PERS'
  const labelKey = external ? 'aris.symbol.externalPerson' : 'aris.symbol.internalPerson'
  const fill = bodyFill('OT_PERS', symbolNum, external ? '#d7c49d' : '#e6cf7a')
  const elements: ArisDrawingElement[] = [
    rect(5, 5, 90, 70, { rx: 10, ry: 10, fill }),
    circle(50, 28, 12, { fill: '#fecdd3' }),
    path('M 30 58 C 30 46, 70 46, 70 58', { fill: 'none', strokeWidth: 3 })
  ]
  if (external) {
    elements.push(line(5, 5, 15, 5, { strokeWidth: 3, stroke: '#e11d48' }))
    elements.push(line(5, 5, 5, 15, { strokeWidth: 3, stroke: '#e11d48' }))
    elements.push(line(85, 75, 95, 75, { strokeWidth: 3, stroke: '#e11d48' }))
    elements.push(line(95, 65, 95, 75, { strokeWidth: 3, stroke: '#e11d48' }))
  }
  return describe(
    `MT_EEPC:OT_PERS:${symbolNum}`,
    'OT_PERS',
    symbolNum,
    labelKey,
    { width: 100, height: 80 },
    { viewBox: viewBox(100, 80), elements }
  )
}

function requirementShape(): ArisSymbolDescriptor {
  const fill = bodyFill('OT_REQUIREMENT', 'ST_REQUIREMENT', '#f7fee7')
  return describe(
    'MT_EEPC:OT_REQUIREMENT:ST_REQUIREMENT',
    'OT_REQUIREMENT',
    'ST_REQUIREMENT',
    'aris.symbol.requirement',
    { width: 100, height: 70 },
    {
      viewBox: viewBox(100, 70),
      elements: [
        rect(5, 5, 90, 60, { rx: 8, ry: 8, fill }),
        line(50, 20, 50, 45, { strokeWidth: 4, stroke: '#65a30d' }),
        circle(50, 52, 5, { fill: '#65a30d' })
      ]
    }
  )
}

function policyShape(): ArisSymbolDescriptor {
  // Shield.
  const fill = bodyFill('OT_POLICY', 'ST_BUSINESS_POLICY', '#fb923c')
  return describe(
    'MT_EEPC:OT_POLICY:ST_BUSINESS_POLICY',
    'OT_POLICY',
    'ST_BUSINESS_POLICY',
    'aris.symbol.policy',
    { width: 100, height: 90 },
    {
      viewBox: viewBox(100, 90),
      elements: [
        path('M 50 10 L 80 22 L 80 45 C 80 68, 50 85, 50 85 C 50 85, 20 68, 20 45 L 20 22 Z', {
          fill
        }),
        line(35, 38, 48, 52, { strokeWidth: 4, stroke: '#16a34a' }),
        line(45, 52, 68, 32, { strokeWidth: 4, stroke: '#16a34a' })
      ]
    }
  )
}

function personTypeShape(): ArisSymbolDescriptor {
  const fill = bodyFill('OT_PERS_TYPE', 'ST_EMPL_TYPE', '#d7c49d')
  const person = (cx: number): ArisDrawingElement[] => [
    circle(cx, 28, 8, { fill: '#fecdd3' }),
    path(`M ${cx - 12} 52 C ${cx - 12} 43, ${cx + 12} 43, ${cx + 12} 52`, {
      fill: 'none',
      strokeWidth: 2
    })
  ]
  return describe(
    'MT_EEPC:OT_PERS_TYPE:ST_EMPL_TYPE',
    'OT_PERS_TYPE',
    'ST_EMPL_TYPE',
    'aris.symbol.personType',
    { width: 100, height: 70 },
    {
      viewBox: viewBox(100, 70),
      elements: [rect(5, 5, 90, 60, { rx: 8, ry: 8, fill }), ...person(38), ...person(62)]
    }
  )
}

// ---------------------------------------------------------------------------
// R1 catalog additions — original line-art geometry, no proprietary artwork.
// ---------------------------------------------------------------------------

function orgUnitShape(): ArisSymbolDescriptor {
  // "Ellipse-in-bar": an organizational unit bar with an oval accent.
  const fill = bodyFill('OT_ORG_UNIT', 'ST_ORG_UNIT_1', '#f59e0b')
  return describe(
    'MT_EEPC:OT_ORG_UNIT:ST_ORG_UNIT_1',
    'OT_ORG_UNIT',
    'ST_ORG_UNIT_1',
    'aris.symbol.organizationalUnit',
    { width: 100, height: 70 },
    {
      viewBox: viewBox(100, 70),
      elements: [
        rect(5, 5, 90, 60, { rx: 6, ry: 6, fill }),
        path('M 20 35 C 20 24, 80 24, 80 35 C 80 46, 20 46, 20 35 Z', {
          fill: 'none',
          strokeWidth: 2
        })
      ]
    }
  )
}

function positionShape(): ArisSymbolDescriptor {
  // A five-point star, the original line-art take on the "position" glyph.
  const fill = bodyFill('OT_POS', 'ST_POS', '#facc15')
  const cx = 50
  const cy = 40
  const outerR = 32
  const innerR = 13
  const points: { x: number; y: number }[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = (Math.PI / 5) * i - Math.PI / 2
    points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) })
  }
  return describe(
    'MT_EEPC:OT_POS:ST_POS',
    'OT_POS',
    'ST_POS',
    'aris.symbol.position',
    { width: 100, height: 80 },
    { viewBox: viewBox(100, 80), elements: [polygon(points, { fill })] }
  )
}

function groupShape(): ArisSymbolDescriptor {
  // A bar with three small person glyphs — "group" as several people.
  const fill = bodyFill('OT_GRP', 'ST_GRP_1', '#a16207')
  const person = (cx: number): ArisDrawingElement[] => [
    circle(cx, 24, 9, { fill: '#fde68a' }),
    path(`M ${cx - 13} 50 C ${cx - 13} 38, ${cx + 13} 38, ${cx + 13} 50`, {
      fill: 'none',
      strokeWidth: 2
    })
  ]
  return describe(
    'MT_EEPC:OT_GRP:ST_GRP_1',
    'OT_GRP',
    'ST_GRP_1',
    'aris.symbol.group',
    { width: 100, height: 70 },
    {
      viewBox: viewBox(100, 70),
      elements: [
        rect(5, 5, 90, 60, { rx: 8, ry: 8, fill }),
        ...person(28),
        ...person(50),
        ...person(72)
      ]
    }
  )
}

function riskShape(): ArisSymbolDescriptor {
  // Warning triangle with an exclamation mark.
  const fill = bodyFill('OT_RISK', 'ST_RISK_1', '#dc2626')
  return describe(
    'MT_EEPC:OT_RISK:ST_RISK_1',
    'OT_RISK',
    'ST_RISK_1',
    'aris.symbol.risk',
    { width: 100, height: 90 },
    {
      viewBox: viewBox(100, 90),
      elements: [
        polygon(
          [
            { x: 50, y: 8 },
            { x: 94, y: 82 },
            { x: 6, y: 82 }
          ],
          { fill, strokeWidth: 3 }
        ),
        line(50, 38, 50, 62, { stroke: '#fef2f2', strokeWidth: 4 }),
        circle(50, 72, 3.5, { fill: '#fef2f2' })
      ]
    }
  )
}

function serviceShape(): ArisSymbolDescriptor {
  // A folded product/service carton box.
  const fill = bodyFill('OT_SERVICE', 'ST_SERVICE', '#8b7355')
  return describe(
    'MT_EEPC:OT_SERVICE:ST_SERVICE',
    'OT_SERVICE',
    'ST_SERVICE',
    'aris.symbol.productService',
    { width: 100, height: 80 },
    {
      viewBox: viewBox(100, 80),
      elements: [
        rect(8, 15, 84, 58, { rx: 4, ry: 4, fill }),
        line(8, 15, 50, 42, { strokeWidth: 2 }),
        line(92, 15, 50, 42, { strokeWidth: 2 }),
        line(50, 42, 50, 73, { strokeWidth: 2 })
      ]
    }
  )
}

// ---------------------------------------------------------------------------
// Exported canonical descriptor table.
// ---------------------------------------------------------------------------

export const ARIS_SYMBOL_DESCRIPTORS: readonly ArisSymbolDescriptor[] = Object.freeze([
  // Functions
  functionShape('plain'),
  functionShape('interface'),
  functionShape('system'),
  functionShape('value-chain'),

  // Event
  eventShape(),

  // Rules
  ruleShape('and'),
  ruleShape('or'),
  ruleShape('xor'),

  // Entity type
  entityTypeShape(),

  // Information carriers
  infoCarrierShape('document'),
  infoCarrierShape('email'),
  infoCarrierShape('edoc'),
  infoCarrierShape('handy'),
  infoCarrierShape('letter'),
  infoCarrierShape('log'),
  infoCarrierShape('general'),

  // Business rule
  businessRuleShape(),

  // Performance
  performanceShape(),

  // Application system
  applicationSystemShape(),

  // Person
  personShape(true),
  personShape(false),

  // Requirement
  requirementShape(),

  // Policy
  policyShape(),

  // Person type
  personTypeShape(),

  // R1 catalog additions
  orgUnitShape(),
  positionShape(),
  groupShape(),
  riskShape(),
  serviceShape()
])

/** Mapping from object type to its canonical default SymbolNum. */
export const ARIS_OBJECT_TYPE_DEFAULT_SYMBOL: Readonly<Record<string, string>> = Object.freeze({
  OT_FUNC: 'ST_FUNC',
  OT_EVT: 'ST_EV',
  OT_RULE: 'ST_OPR_AND_1',
  OT_ENT_TYPE: 'ST_ENT_TYPE',
  OT_INFO_CARR: 'ST_INFO_CARR_EDOC',
  OT_BUSINESS_RULE: 'ST_BUSINESS_RULE',
  OT_PERF: 'ST_PERFORM',
  OT_APPL_SYS: 'ST_APPL_SYS',
  OT_PERS: 'ST_PERS_EXT',
  OT_REQUIREMENT: 'ST_REQUIREMENT',
  OT_POLICY: 'ST_BUSINESS_POLICY',
  OT_PERS_TYPE: 'ST_EMPL_TYPE',
  // R1 catalog additions
  OT_ORG_UNIT: 'ST_ORG_UNIT_1',
  OT_POS: 'ST_POS',
  OT_GRP: 'ST_GRP_1',
  OT_RISK: 'ST_RISK_1',
  OT_SERVICE: 'ST_SERVICE'
})
