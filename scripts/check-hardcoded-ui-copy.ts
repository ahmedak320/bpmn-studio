import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export type HardcodedUiCopyKind = 'jsx-text' | 'jsx-expression' | 'attribute' | 'user-message-call'

export interface HardcodedUiCopyFinding {
  file: string
  line: number
  column: number
  kind: HardcodedUiCopyKind
  text: string
  signature: string
}

export interface HardcodedUiCopyAllowlistEntry {
  signature: string
  reason: string
}

export interface HardcodedUiCopyAudit {
  findings: readonly HardcodedUiCopyFinding[]
  violations: readonly HardcodedUiCopyFinding[]
  staleAllowlist: readonly HardcodedUiCopyAllowlistEntry[]
}

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SOURCE_ROOT = resolve(REPOSITORY_ROOT, 'src')
const ENGLISH_WORD = /[A-Za-z]{2,}/

const USER_FACING_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-roledescription',
  'caption',
  'cancelLabel',
  'confirmLabel',
  'description',
  'emptyMessage',
  'label',
  'message',
  'placeholder',
  'summary',
  'title',
  'tooltip'
])

const USER_MESSAGE_CALLS = new Set([
  'alert',
  'confirm',
  'prompt',
  'pushToast',
  'setError',
  'setMessage',
  'setResultLabel',
  'setSaved',
  'setStatus',
  'setToast',
  'showToast'
])

/**
 * Every exception is exact and reviewable. Technical/brand tokens stay
 * invariant in both languages.
 */
export const HARDCODED_UI_COPY_ALLOWLIST: readonly HardcodedUiCopyAllowlistEntry[] = Object.freeze([
  {
    signature: 'src/ai/AiPanelLite.tsx|jsx-text|MB',
    reason: 'Invariant file-size unit symbol, not English prose.'
  },
  {
    signature: 'src/editor/ProcessOutlineEditor.tsx|jsx-text|ID',
    reason: 'Invariant technical identifier token; the rendered term is marked lang="en".'
  },
  {
    signature: 'src/workspace/BackupImportDialog.tsx|jsx-text|KiB',
    reason: 'Invariant IEC file-size unit symbol, not English prose.'
  },
  {
    signature: 'src/workspace/HistoryDialog.tsx|jsx-text|KiB',
    reason: 'Invariant IEC file-size unit symbol, not English prose.'
  },
  {
    signature: 'src/workspace/WorkspacePickerLite.tsx|attribute|OrbitPM',
    reason: 'Product brand name; it is not translated.'
  }
])

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stablePath(file: string, repositoryRoot = REPOSITORY_ROOT): string {
  return relative(repositoryRoot, file).split(sep).join('/')
}

function staticText(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('${…}')
  }
  return null
}

function renderedStaticText(
  node: ts.Expression,
  values: Array<{ node: ts.Node; text: string }> = []
): Array<{ node: ts.Node; text: string }> {
  const direct = staticText(node)
  if (direct !== null) {
    values.push({ node, text: direct })
    return values
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return renderedStaticText(node.expression, values)
  }
  if (ts.isConditionalExpression(node)) {
    renderedStaticText(node.whenTrue, values)
    renderedStaticText(node.whenFalse, values)
    return values
  }
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    renderedStaticText(node.left, values)
    renderedStaticText(node.right, values)
  }
  return values
}

function callName(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return null
}

export function scanTsxSource(
  file: string,
  source: string,
  repositoryRoot = REPOSITORY_ROOT
): HardcodedUiCopyFinding[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const findings: HardcodedUiCopyFinding[] = []
  const add = (node: ts.Node, kind: HardcodedUiCopyKind, rawText: string): void => {
    const text = normalizeText(rawText)
    if (!text || !ENGLISH_WORD.test(text)) return
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    const normalizedFile = stablePath(file, repositoryRoot)
    findings.push({
      file: normalizedFile,
      line: location.line + 1,
      column: location.character + 1,
      kind,
      text,
      signature: `${normalizedFile}|${kind}|${text}`
    })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) add(node, 'jsx-text', node.text)

    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile)
      if (USER_FACING_ATTRIBUTES.has(name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          add(node, 'attribute', node.initializer.text)
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          for (const value of renderedStaticText(node.initializer.expression)) {
            add(value.node, 'attribute', value.text)
          }
        }
      }
    }

    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression) {
      for (const value of renderedStaticText(node.expression)) {
        add(value.node, 'jsx-expression', value.text)
      }
    }

    if (ts.isCallExpression(node)) {
      const name = callName(node.expression)
      const firstArgument = node.arguments[0]
      if (name && USER_MESSAGE_CALLS.has(name) && firstArgument) {
        for (const value of renderedStaticText(firstArgument)) {
          add(value.node, 'user-message-call', value.text)
        }
      }
    }

    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return findings
}

function collectProductionTsx(directory: string, output: string[] = []): string[] {
  for (const entry of readdirSync(directory).sort()) {
    const full = resolve(directory, entry)
    const metadata = statSync(full)
    if (metadata.isDirectory()) {
      if (entry !== '__tests__') collectProductionTsx(full, output)
      continue
    }
    if (entry.endsWith('.tsx') && !/\.(?:test|spec|integration)\.tsx$/i.test(entry)) {
      output.push(full)
    }
  }
  return output
}

export function auditHardcodedUiCopy(
  sourceRoot = DEFAULT_SOURCE_ROOT,
  allowlist = HARDCODED_UI_COPY_ALLOWLIST
): HardcodedUiCopyAudit {
  const findings = collectProductionTsx(sourceRoot).flatMap((file) =>
    scanTsxSource(file, readFileSync(file, 'utf8'))
  )
  const allowed = new Set(allowlist.map((entry) => entry.signature))
  const seen = new Set(findings.map((finding) => finding.signature))
  return {
    findings,
    violations: findings.filter((finding) => !allowed.has(finding.signature)),
    staleAllowlist: allowlist.filter((entry) => !seen.has(entry.signature))
  }
}

export function formatHardcodedUiCopyFinding(finding: HardcodedUiCopyFinding): string {
  return `${finding.file}:${finding.line}:${finding.column} ${finding.kind} ${JSON.stringify(finding.text)}`
}

const invokedAsScript = process.argv
  .slice(1)
  .some((argument) => resolve(argument) === fileURLToPath(import.meta.url))

if (invokedAsScript) {
  const result = auditHardcodedUiCopy()
  if (result.violations.length > 0 || result.staleAllowlist.length > 0) {
    if (result.violations.length > 0) {
      console.error('Hard-coded user-facing English found:')
      for (const finding of result.violations) {
        console.error(`- ${formatHardcodedUiCopyFinding(finding)}`)
      }
    }
    if (result.staleAllowlist.length > 0) {
      console.error('Stale hard-coded-copy allowlist entries:')
      for (const entry of result.staleAllowlist) {
        console.error(`- ${entry.signature}: ${entry.reason}`)
      }
    }
    process.exitCode = 1
  } else {
    console.log(
      `Hard-coded UI copy check passed (${result.findings.length} exact reviewed findings, ${HARDCODED_UI_COPY_ALLOWLIST.length} allowlist entries).`
    )
  }
}
