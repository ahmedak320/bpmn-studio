/**
 * Port of `core/json_parser.py` (parse_json_loose) from the vendored
 * bpmn-assistant. Parses JSON from raw model output with fallbacks for the
 * common wrappers: leading/trailing prose, markdown code fences, and a scan for
 * the first balanced `{...}`/`[...]` snippet.
 *
 * Candidate order (identical to Python): the whole trimmed string first, then
 * each fenced block, then the first balanced JSON snippet — first that parses
 * wins; otherwise the last parse error is rethrown.
 */

/**
 * Scan from an opening bracket at `start` and return the index just past its
 * matching close, respecting strings/escapes. Returns -1 if never balanced.
 * (JS stand-in for Python's json.JSONDecoder().raw_decode greedy first-value.)
 */
function scanBalanced(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (c === '\\') {
        escaped = true
      } else if (c === '"') {
        inString = false
      }
      continue
    }
    if (c === '"') {
      inString = true
    } else if (c === '{' || c === '[') {
      depth += 1
    } else if (c === '}' || c === ']') {
      depth -= 1
      if (depth === 0) {
        return i + 1
      }
    }
  }
  return -1
}

/** Find the first decodable JSON object/array snippet inside arbitrary text. */
function findFirstJsonSnippet(text: string): string | null {
  for (let idx = 0; idx < text.length; idx++) {
    const char = text[idx]
    if (char !== '{' && char !== '[') {
      continue
    }
    const end = scanBalanced(text, idx)
    if (end !== -1) {
      const candidate = text.slice(idx, end)
      try {
        JSON.parse(candidate)
        return candidate
      } catch {
        // Not valid JSON starting here; keep scanning.
      }
    }
  }
  return null
}

/**
 * Parse JSON from raw model output with markdown/prose fallbacks.
 * @throws the last JSON parse error if no candidate is decodable.
 */
export function parseJsonLoose(rawOutput: string): unknown {
  const cleaned = rawOutput.trim()
  const candidates: string[] = []

  if (cleaned) {
    candidates.push(cleaned)
  }

  const fenceRe = /```(?:json)?\s*([\s\S]*?)\s*```/gi
  let match: RegExpExecArray | null
  while ((match = fenceRe.exec(cleaned)) !== null) {
    const block = match[1].trim()
    if (block) {
      candidates.push(block)
    }
  }

  const firstSnippet = findFirstJsonSnippet(cleaned)
  if (firstSnippet) {
    candidates.push(firstSnippet)
  }

  const seen = new Set<string>()
  const uniqueCandidates: string[] = []
  for (const candidate of candidates) {
    if (!seen.has(candidate)) {
      seen.add(candidate)
      uniqueCandidates.push(candidate)
    }
  }

  let lastError: unknown = null
  for (const candidate of uniqueCandidates) {
    try {
      return JSON.parse(candidate)
    } catch (e) {
      lastError = e
    }
  }

  if (lastError !== null) {
    throw lastError
  }
  throw new SyntaxError('No JSON content found')
}
