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

  const elements: ArisDrawingElement[] = []

  if (variant === 'value-chain') {
    elements.push(rect(5, 15, 90, 30, { rx: 4, ry: 4, fill: '#f3f4f6' }))
  } else {
    elements.push(rect(5, 10, 90, 50, { rx: 12, ry: 12, fill: '#f3f4f6' }))
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
      { fill: '#fff7ed' }
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
  const elements: ArisDrawingElement[] = [circle(50, 50, 40, { fill: '#eef2ff' })]

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
  return describe(
    'MT_EEPC:OT_ENT_TYPE:ST_ENT_TYPE',
    'OT_ENT_TYPE',
    'ST_ENT_TYPE',
    'aris.symbol.entityType',
    { width: 100, height: 70 },
    {
      viewBox: viewBox(100, 70),
      elements: [
        rect(5, 5, 90, 60, { rx: 6, ry: 6, fill: '#f0fdf4' }),
        line(28, 5, 28, 65, { strokeWidth: 4 })
      ]
    }
  )
}

function infoCarrierShape(variant: 'document' | 'email' | 'edoc' | 'handy'): ArisSymbolDescriptor {
  const symbolNum =
    variant === 'email'
      ? 'ST_EMAIL_1'
      : variant === 'edoc'
        ? 'ST_INFO_CARR_EDOC'
        : variant === 'handy'
          ? 'ST_INFO_CARR_HANDY'
          : 'ST_DOC'
  const labelKey =
    variant === 'email'
      ? 'aris.symbol.email'
      : variant === 'edoc'
        ? 'aris.symbol.eDocument'
        : variant === 'handy'
          ? 'aris.symbol.mobile'
          : 'aris.symbol.document'
  const elements: ArisDrawingElement[] = []

  if (variant === 'email') {
    elements.push(rect(5, 20, 90, 60, { rx: 4, ry: 4, fill: '#eff6ff' }))
    elements.push(path('M 5 20 L 50 55 L 95 20', { fill: 'none' }))
  } else if (variant === 'handy') {
    elements.push(rect(35, 10, 30, 70, { rx: 6, ry: 6, fill: '#f5f3ff' }))
    elements.push(line(50, 5, 50, 15, { strokeWidth: 3 }))
    elements.push(circle(50, 75, 5, { fill: '#c4b5fd' }))
  } else {
    // Document with folded corner.
    elements.push(rect(5, 5, 90, 75, { rx: 4, ry: 4, fill: '#eff6ff' }))
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
  return describe(
    'MT_EEPC:OT_BUSINESS_RULE:ST_BUSINESS_RULE',
    'OT_BUSINESS_RULE',
    'ST_BUSINESS_RULE',
    'aris.symbol.businessRule',
    { width: 100, height: 70 },
    {
      viewBox: viewBox(100, 70),
      elements: [
        rect(5, 5, 90, 60, { rx: 8, ry: 8, fill: '#fefce8' }),
        line(50, 20, 50, 45, { strokeWidth: 2 }),
        line(30, 30, 70, 30, { strokeWidth: 2 }),
        path('M 28 30 C 24 38, 24 38, 30 38 C 36 38, 36 38, 32 30', { fill: '#fde047' }),
        path('M 68 30 C 64 38, 64 38, 70 38 C 76 38, 76 38, 72 30', { fill: '#fde047' })
      ]
    }
  )
}

function performanceShape(): ArisSymbolDescriptor {
  // Rounded rectangle with a gauge arc and needle.
  return describe(
    'MT_EEPC:OT_PERF:ST_PERFORM',
    'OT_PERF',
    'ST_PERFORM',
    'aris.symbol.performance',
    { width: 100, height: 70 },
    {
      viewBox: viewBox(100, 70),
      elements: [
        rect(5, 5, 90, 60, { rx: 8, ry: 8, fill: '#fdf2f8' }),
        path('M 25 50 A 25 25 0 0 1 75 50', { fill: 'none', strokeWidth: 3 }),
        line(50, 50, 62, 32, { strokeWidth: 3, stroke: '#db2777' })
      ]
    }
  )
}

function applicationSystemShape(): ArisSymbolDescriptor {
  // Monitor with a stand.
  return describe(
    'MT_EEPC:OT_APPL_SYS:ST_APPL_SYS',
    'OT_APPL_SYS',
    'ST_APPL_SYS',
    'aris.symbol.applicationSystem',
    { width: 100, height: 80 },
    {
      viewBox: viewBox(100, 80),
      elements: [
        rect(10, 10, 80, 50, { rx: 4, ry: 4, fill: '#ecfeff' }),
        line(35, 60, 35, 72, { strokeWidth: 3 }),
        line(25, 72, 65, 72, { strokeWidth: 3 }),
        rect(15, 15, 70, 35, { fill: '#cffafe' })
      ]
    }
  )
}

function personShape(external: boolean): ArisSymbolDescriptor {
  const symbolNum = external ? 'ST_PERS_EXT' : 'ST_PERS'
  const labelKey = external ? 'aris.symbol.externalPerson' : 'aris.symbol.person'
  const elements: ArisDrawingElement[] = [
    rect(5, 5, 90, 70, { rx: 10, ry: 10, fill: '#fff1f2' }),
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
  return describe(
    'MT_EEPC:OT_REQUIREMENT:ST_REQUIREMENT',
    'OT_REQUIREMENT',
    'ST_REQUIREMENT',
    'aris.symbol.requirement',
    { width: 100, height: 70 },
    {
      viewBox: viewBox(100, 70),
      elements: [
        rect(5, 5, 90, 60, { rx: 8, ry: 8, fill: '#f7fee7' }),
        line(50, 20, 50, 45, { strokeWidth: 4, stroke: '#65a30d' }),
        circle(50, 52, 5, { fill: '#65a30d' })
      ]
    }
  )
}

function policyShape(): ArisSymbolDescriptor {
  // Shield.
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
          fill: '#fff7ed'
        }),
        line(35, 38, 48, 52, { strokeWidth: 4, stroke: '#16a34a' }),
        line(45, 52, 68, 32, { strokeWidth: 4, stroke: '#16a34a' })
      ]
    }
  )
}

function personTypeShape(): ArisSymbolDescriptor {
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
      elements: [
        rect(5, 5, 90, 60, { rx: 8, ry: 8, fill: '#fff1f2' }),
        ...person(38),
        ...person(62)
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

  // Business rule
  businessRuleShape(),

  // Performance
  performanceShape(),

  // Application system
  applicationSystemShape(),

  // Person
  personShape(true),

  // Requirement
  requirementShape(),

  // Policy
  policyShape(),

  // Person type
  personTypeShape()
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
  OT_PERS_TYPE: 'ST_EMPL_TYPE'
})
