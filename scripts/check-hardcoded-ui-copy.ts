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
  'recordWorkspaceIssue',
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
  return null
}

type StaticTextValue = { node: ts.Node; text: string }
type IdentifierInitializerResolver = (identifier: ts.Identifier) => ts.Expression | null

function renderedStaticText(
  node: ts.Expression,
  values: StaticTextValue[] = [],
  resolveIdentifier?: IdentifierInitializerResolver,
  activeExpressions: Set<ts.Expression> = new Set()
): StaticTextValue[] {
  if (activeExpressions.has(node)) return values
  activeExpressions.add(node)

  const direct = staticText(node)
  if (direct !== null) {
    values.push({ node, text: direct })
    activeExpressions.delete(node)
    return values
  }
  if (ts.isTemplateExpression(node)) {
    values.push({
      node,
      text: [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('${…}')
    })
    for (const span of node.templateSpans) {
      renderedStaticText(span.expression, values, resolveIdentifier, activeExpressions)
    }
    activeExpressions.delete(node)
    return values
  }
  if (ts.isIdentifier(node) && resolveIdentifier) {
    const initializer = resolveIdentifier(node)
    if (initializer) {
      renderedStaticText(initializer, values, resolveIdentifier, activeExpressions)
    }
    activeExpressions.delete(node)
    return values
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    renderedStaticText(node.expression, values, resolveIdentifier, activeExpressions)
    activeExpressions.delete(node)
    return values
  }
  if (ts.isConditionalExpression(node)) {
    renderedStaticText(node.whenTrue, values, resolveIdentifier, activeExpressions)
    renderedStaticText(node.whenFalse, values, resolveIdentifier, activeExpressions)
    activeExpressions.delete(node)
    return values
  }
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.PlusToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    renderedStaticText(node.left, values, resolveIdentifier, activeExpressions)
    renderedStaticText(node.right, values, resolveIdentifier, activeExpressions)
  } else if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    // The left operand is a truthiness guard; only the right operand can be
    // the value React renders or a message sink receives.
    renderedStaticText(node.right, values, resolveIdentifier, activeExpressions)
  }
  activeExpressions.delete(node)
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
  const findingKeys = new Set<string>()
  const bindingsByScope = new Map<ts.Node, Map<string, ts.VariableDeclaration[]>>()

  const isLexicalScope = (node: ts.Node): boolean =>
    ts.isBlock(node) ||
    ts.isSourceFile(node) ||
    ts.isCaseBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)

  const nearestLexicalScope = (node: ts.Node): ts.Node | null => {
    let current: ts.Node | undefined = node.parent
    while (current) {
      if (isLexicalScope(current)) return current
      current = current.parent
    }
    return null
  }

  const collectBindings = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const scope = nearestLexicalScope(node)
      if (scope) {
        const byName = bindingsByScope.get(scope) ?? new Map<string, ts.VariableDeclaration[]>()
        const declarations = byName.get(node.name.text) ?? []
        declarations.push(node)
        byName.set(node.name.text, declarations)
        bindingsByScope.set(scope, byName)
      }
    }
    ts.forEachChild(node, collectBindings)
  }
  collectBindings(sourceFile)

  const resolveIdentifierInitializer: IdentifierInitializerResolver = (identifier) => {
    const referencePosition = identifier.getStart(sourceFile)
    let current: ts.Node | undefined = identifier.parent
    while (current) {
      if (isLexicalScope(current)) {
        const declarations = bindingsByScope.get(current)?.get(identifier.text)
        if (declarations && declarations.length > 0) {
          const declaration = [...declarations]
            .filter((candidate) => candidate.getStart(sourceFile) < referencePosition)
            .sort((left, right) => right.getStart(sourceFile) - left.getStart(sourceFile))[0]
          return declaration?.initializer ?? null
        }
      }
      if (
        ts.isFunctionLike(current) &&
        current.parameters.some(
          (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === identifier.text
        )
      ) {
        return null
      }
      if (
        ts.isCatchClause(current) &&
        current.variableDeclaration &&
        ts.isIdentifier(current.variableDeclaration.name) &&
        current.variableDeclaration.name.text === identifier.text
      ) {
        return current.variableDeclaration.initializer ?? null
      }
      current = current.parent
    }
    return null
  }

  const resolvesToParameter = (
    identifier: ts.Identifier,
    target: ts.ParameterDeclaration
  ): boolean => {
    const referencePosition = identifier.getStart(sourceFile)
    let current: ts.Node | undefined = identifier.parent
    while (current) {
      if (isLexicalScope(current)) {
        const declaration = bindingsByScope
          .get(current)
          ?.get(identifier.text)
          ?.some((candidate) => candidate.getStart(sourceFile) < referencePosition)
        if (declaration) return false
      }
      if (ts.isFunctionLike(current)) {
        const parameter = current.parameters.find(
          (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === identifier.text
        )
        if (parameter) return parameter === target
      }
      if (
        ts.isCatchClause(current) &&
        current.variableDeclaration &&
        ts.isIdentifier(current.variableDeclaration.name) &&
        current.variableDeclaration.name.text === identifier.text
      ) {
        return false
      }
      current = current.parent
    }
    return false
  }

  const expressionDependsOnParameter = (
    node: ts.Node,
    parameter: ts.ParameterDeclaration,
    activeNodes: Set<ts.Node> = new Set()
  ): boolean => {
    if (activeNodes.has(node)) return false
    activeNodes.add(node)
    if (ts.isIdentifier(node)) {
      if (resolvesToParameter(node, parameter)) {
        activeNodes.delete(node)
        return true
      }
      const initializer = resolveIdentifierInitializer(node)
      if (initializer && expressionDependsOnParameter(initializer, parameter, activeNodes)) {
        activeNodes.delete(node)
        return true
      }
    }
    let found = false
    ts.forEachChild(node, (child) => {
      if (!found && expressionDependsOnParameter(child, parameter, activeNodes)) {
        found = true
      }
    })
    activeNodes.delete(node)
    return found
  }

  type LocalFunction = {
    name: string
    functionNode: ts.FunctionLikeDeclaration
  }
  const localFunctions: LocalFunction[] = []
  const functionFromInitializer = (
    initializer: ts.Expression | undefined
  ): ts.FunctionLikeDeclaration | null => {
    if (!initializer) return null
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
      return initializer
    }
    if (ts.isCallExpression(initializer)) {
      const callback = initializer.arguments.find(
        (argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
      )
      return callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
        ? callback
        : null
    }
    return null
  }
  const collectLocalFunctions = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      localFunctions.push({ name: node.name.text, functionNode: node })
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const functionNode = functionFromInitializer(node.initializer)
      if (functionNode) localFunctions.push({ name: node.name.text, functionNode })
    }
    ts.forEachChild(node, collectLocalFunctions)
  }
  collectLocalFunctions(sourceFile)

  const forwardedMessageParameters = new Map<string, Set<number>>()
  let forwardingChanged = true
  while (forwardingChanged) {
    forwardingChanged = false
    for (const localFunction of localFunctions) {
      const forwarded = forwardedMessageParameters.get(localFunction.name) ?? new Set<number>()
      const visitFunctionBody = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const name = callName(node.expression)
          const sinkIndexes = new Set<number>()
          if (name && USER_MESSAGE_CALLS.has(name)) sinkIndexes.add(0)
          if (name && ts.isIdentifier(node.expression)) {
            for (const index of forwardedMessageParameters.get(name) ?? []) {
              sinkIndexes.add(index)
            }
          }
          for (const sinkIndex of sinkIndexes) {
            const argument = node.arguments[sinkIndex]
            if (!argument) continue
            localFunction.functionNode.parameters.forEach((parameter, parameterIndex) => {
              if (
                !forwarded.has(parameterIndex) &&
                expressionDependsOnParameter(argument, parameter)
              ) {
                forwarded.add(parameterIndex)
                forwardingChanged = true
              }
            })
          }
        }
        ts.forEachChild(node, visitFunctionBody)
      }
      if (localFunction.functionNode.body) {
        visitFunctionBody(localFunction.functionNode.body)
      }
      if (forwarded.size > 0) {
        forwardedMessageParameters.set(localFunction.name, forwarded)
      }
    }
  }

  const add = (node: ts.Node, kind: HardcodedUiCopyKind, rawText: string): void => {
    const text = normalizeText(rawText)
    if (!text || !ENGLISH_WORD.test(text)) return
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    const normalizedFile = stablePath(file, repositoryRoot)
    const findingKey = `${normalizedFile}|${node.getStart(sourceFile)}|${kind}|${text}`
    if (findingKeys.has(findingKey)) return
    findingKeys.add(findingKey)
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
          for (const value of renderedStaticText(
            node.initializer.expression,
            [],
            resolveIdentifierInitializer
          )) {
            add(value.node, 'attribute', value.text)
          }
        }
      }
    }

    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression) {
      for (const value of renderedStaticText(node.expression, [], resolveIdentifierInitializer)) {
        add(value.node, 'jsx-expression', value.text)
      }
    }

    if (ts.isCallExpression(node)) {
      const name = callName(node.expression)
      const sinkIndexes = new Set<number>()
      if (name && USER_MESSAGE_CALLS.has(name)) sinkIndexes.add(0)
      if (name && ts.isIdentifier(node.expression)) {
        for (const index of forwardedMessageParameters.get(name) ?? []) sinkIndexes.add(index)
      }
      for (const sinkIndex of sinkIndexes) {
        const argument = node.arguments[sinkIndex]
        if (!argument) continue
        for (const value of renderedStaticText(argument, [], resolveIdentifierInitializer)) {
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
