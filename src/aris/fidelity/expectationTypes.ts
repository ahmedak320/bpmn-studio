/**
 * Hand-authored fidelity expectation contracts for ARIS model comparison.
 *
 * An expectation describes the canonical content of one ARIS model: its control-flow
 * spine, satellite objects attached to functions, rule gates, free-text notes, and
 * occurrence counts. The comparator in `compare.ts` turns an `ArisWorkingDocument`
 * into the same shape and produces a structured diff report.
 */

export interface FidelityExpectationDoc {
  readonly modelKey: string
  readonly modelIdHint: string | null
  readonly nameEn: string
  readonly spine: readonly SpineStep[]
  readonly satellites: Readonly<Record<string, readonly SatelliteExpectation[]>>
  readonly gates: readonly GateExpectation[]
  readonly notes: readonly NoteExpectation[]
  readonly counts: {
    readonly functions: number
    readonly events: number
    readonly rules: number
    readonly connections: number
  }
}

export interface SpineStep {
  readonly kind: 'function' | 'event' | 'rule'
  readonly nameEn: string
  readonly nameAr?: string
  readonly numbering: string | null
  readonly symbolNum: string | null
  readonly fill: string | null
}

export interface SatelliteExpectation {
  readonly nameEn: string
  readonly nameAr?: string
  readonly objectType: string
  readonly side: 'left' | 'right'
  readonly connectionType: string
  readonly raci: 'R' | 'A' | 'C' | 'I' | null
  readonly symbolNum: string | null
  readonly fill: string | null
}

export interface GateExpectation {
  readonly operator: 'AND' | 'OR' | 'XOR'
  readonly afterNameEn: string
  readonly afterNameAr?: string
  readonly branchFirstNamesEn: readonly string[]
  readonly branchFirstNamesAr?: readonly string[]
}

export interface NoteExpectation {
  readonly contains: string
}

export interface FidelityDiffRow {
  readonly category:
    'spine' | 'numbering' | 'satellite' | 'symbol' | 'color' | 'gate' | 'note' | 'count'
  readonly status: 'missing' | 'extra' | 'mismatched'
  readonly expected: string | null
  readonly actual: string | null
  readonly where: string
}

export interface FidelityDiffReport {
  readonly rows: readonly FidelityDiffRow[]
  readonly byCategory: Readonly<Record<string, number>>
  readonly pass: boolean
}
