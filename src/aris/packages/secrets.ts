/**
 * Credential detection for OrbitPM-authored ARIS package artifacts (plan §7.4:
 * "API keys never enter the package").
 *
 * This scanner is applied to artifacts OrbitPM writes itself — manifest,
 * accounting, revisions, current-revision pointer — and never to the imported
 * original or to user attachments, because those must be preserved byte-for-byte
 * even when their content coincidentally resembles a credential.
 *
 * Findings never carry the matched text: only a code, an offset and a length.
 */

export type SecretFindingCode =
  | 'openai-style-key'
  | 'anthropic-style-key'
  | 'aws-access-key-id'
  | 'github-token'
  | 'slack-token'
  | 'google-api-key'
  | 'json-web-token'
  | 'private-key-block'
  | 'bearer-credential'
  | 'credential-assignment'

export interface SecretFinding {
  readonly code: SecretFindingCode
  /** Index of the match within the scanned text. */
  readonly index: number
  /** Length of the match. The matched text itself is deliberately not kept. */
  readonly length: number
}

interface SecretRule {
  readonly code: SecretFindingCode
  readonly pattern: RegExp
}

const RULES: readonly SecretRule[] = Object.freeze([
  { code: 'anthropic-style-key', pattern: /sk-ant-[A-Za-z0-9_-]{16,}/g },
  { code: 'openai-style-key', pattern: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/g },
  { code: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { code: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { code: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { code: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{30,}/g },
  {
    code: 'json-web-token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g
  },
  { code: 'private-key-block', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g },
  { code: 'bearer-credential', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/g },
  {
    code: 'credential-assignment',
    pattern:
      /\b(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|password|authorization)\b\s*["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}/gi
  }
])

/** Every credential-shaped match in `text`, ordered by offset then code. */
export function findSecretLikeMatches(text: string): readonly SecretFinding[] {
  const findings: SecretFinding[] = []
  for (const rule of RULES) {
    // A fresh RegExp per scan keeps `lastIndex` state out of the module.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags)
    let match = pattern.exec(text)
    while (match !== null) {
      findings.push(
        Object.freeze({ code: rule.code, index: match.index, length: match[0].length })
      )
      if (match[0].length === 0) pattern.lastIndex += 1
      match = pattern.exec(text)
    }
  }
  return Object.freeze(
    findings.sort((left, right) =>
      left.index !== right.index
        ? left.index - right.index
        : left.code < right.code
          ? -1
          : left.code > right.code
            ? 1
            : 0
    )
  )
}

export function containsSecretLikeText(text: string): boolean {
  return findSecretLikeMatches(text).length > 0
}

export class ArisSecretMaterialError extends Error {
  readonly findings: readonly SecretFinding[]
  readonly location: string

  constructor(location: string, findings: readonly SecretFinding[]) {
    super(
      `Credential-shaped content was rejected in "${location}" (${findings
        .map((finding) => finding.code)
        .join(', ')}). API keys must never enter an ARIS source package.`
    )
    this.name = 'ArisSecretMaterialError'
    this.location = location
    this.findings = Object.freeze([...findings])
  }
}

/** Fail closed on any credential-shaped content in an OrbitPM-authored artifact. */
export function assertNoSecretMaterial(location: string, text: string): void {
  const findings = findSecretLikeMatches(text)
  if (findings.length > 0) throw new ArisSecretMaterialError(location, findings)
}
