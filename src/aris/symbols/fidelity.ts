import type { ArisSymbolFidelityFinding, ArisSymbolResolutionResult } from './types'

/**
 * Builds fidelity findings from a set of resolved symbols — Plan Section 12.3.
 *
 * The result is structured data with i18n message keys so the fidelity-report UI can
 * consume it directly.  Findings are deduplicated by their deterministic identity.
 */
export function buildSymbolFidelityFindings(
  resolved: readonly ArisSymbolResolutionResult[]
): readonly ArisSymbolFidelityFinding[] {
  const seen = new Set<string>()
  const findings: ArisSymbolFidelityFinding[] = []
  for (const result of resolved) {
    for (const finding of result.fidelity) {
      const identity = `${finding.kind}:${finding.modelType}:${finding.objectType}:${finding.symbolNum}:${finding.requestedKey}:${finding.resolvedKey}`
      if (seen.has(identity)) continue
      seen.add(identity)
      findings.push(finding)
    }
  }
  return Object.freeze(findings)
}

/** Counts fidelity findings by kind. */
export function countSymbolFidelityByKind(
  findings: readonly ArisSymbolFidelityFinding[]
): Readonly<Record<ArisSymbolFidelityFinding['kind'], number>> {
  const counts: Record<ArisSymbolFidelityFinding['kind'], number> = {
    'unknown-custom-symbol': 0,
    'substituted-visual-resource': 0,
    'missing-template': 0
  }
  for (const finding of findings) {
    counts[finding.kind] += 1
  }
  return Object.freeze(counts)
}
