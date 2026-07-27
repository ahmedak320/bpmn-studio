function decodeUsesScalar(rawValue, label) {
  const trimmed = rawValue.trim()
  if (!trimmed || trimmed === '|' || trimmed === '>' || /^\$\{\{/u.test(trimmed)) {
    throw new Error(`${label} has an empty, block, or dynamic uses value.`)
  }
  if (trimmed.startsWith("'")) {
    const match = trimmed.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/u)
    if (!match) throw new Error(`${label} has an invalid quoted uses value.`)
    return match[1].replaceAll("''", "'")
  }
  if (trimmed.startsWith('"')) {
    const match = trimmed.match(/^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/u)
    if (!match) throw new Error(`${label} has an invalid quoted uses value.`)
    try {
      return JSON.parse(`"${match[1]}"`)
    } catch {
      throw new Error(`${label} has an invalid quoted uses value.`)
    }
  }
  const value = trimmed.replace(/\s+#.*$/u, '')
  if (/\s/u.test(value) || /['"]|[\r\n]/u.test(value)) {
    throw new Error(`${label} has an unparseable uses value.`)
  }
  return value
}

function validateUsesTarget(target, label) {
  if (target.startsWith('./')) {
    if (
      !/^\.\/\.github\/(?:actions\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*|workflows\/[A-Za-z0-9_.-]+\.ya?ml)$/u.test(
        target
      ) ||
      target.includes('@') ||
      target.includes('${{') ||
      /[\s\\?#]/u.test(target) ||
      [...target].some((character) => {
        const codePoint = character.codePointAt(0)
        return codePoint <= 0x1f || codePoint === 0x7f
      }) ||
      target
        .slice(2)
        .split('/')
        .some((segment) => segment === '.' || segment === '..' || segment === '')
    ) {
      throw new Error(`${label} has an unsafe local uses target ${target}.`)
    }
    return
  }
  if (target.startsWith('docker://')) {
    if (!/^docker:\/\/[^@\s]+@sha256:[a-f0-9]{64}$/u.test(target)) {
      throw new Error(`${label} must pin its docker image by lowercase SHA-256 digest.`)
    }
    return
  }
  const separator = target.lastIndexOf('@')
  const action = separator < 1 ? '' : target.slice(0, separator)
  const reference = separator < 1 ? '' : target.slice(separator + 1)
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?$/u.test(action) ||
    !/^[a-f0-9]{40}$/u.test(reference)
  ) {
    throw new Error(`${label} remote action must use owner/repository[/path]@<40 lowercase hex>.`)
  }
}

export function findActionPinFailures(source, path = 'workflow.yml') {
  const failures = []
  let blockScalarIndent = null
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const indentation = line.match(/^\s*/u)[0].length
    if (blockScalarIndent !== null) {
      if (line.trim() === '' || indentation > blockScalarIndent) continue
      blockScalarIndent = null
    }
    if (line.trimStart().startsWith('#')) continue
    const suspiciousKeySyntax =
      /^\s*(?:-\s*)?(?:\?\s|<<\s*:|[!&*][^\s:]*\s*:)/u.test(line) ||
      /^\s*(?:-\s*)?(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|\*[A-Za-z0-9_-]+)\s*:/u.test(line) ||
      /(?:^|[{,]\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|\*[A-Za-z0-9_-]+)\s*:/u.test(line)
    if (suspiciousKeySyntax) {
      failures.push(`${path}:${index + 1} uses unsupported YAML mapping-key syntax.`)
      continue
    }
    const match = line.match(/^\s*(?:-\s*)?uses\s*:\s*(.*)$/u)
    const looksLikeUses = /(?:^|[\s,{])(?:["']?uses["']?)\s*:/u.test(line)
    if (match) {
      const label = `${path}:${index + 1}`
      try {
        validateUsesTarget(decodeUsesScalar(match[1], label), label)
      } catch (error) {
        failures.push(error.message)
      }
      continue
    }
    if (looksLikeUses) {
      failures.push(`${path}:${index + 1} has an unparseable uses key.`)
      continue
    }
    const blockScalar = line.match(
      /^(\s*)(-\s*)?[A-Za-z0-9_-]+\s*:\s*[>|](?:[+-]?[1-9]|[1-9][+-]?)?\s*(?:#.*)?$/u
    )
    if (blockScalar) {
      blockScalarIndent = blockScalar[1].length + (blockScalar[2]?.length ?? 0)
    }
  }
  return failures
}
