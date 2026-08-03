/**
 * Canonical id safety (production-hardening: safe id minting for adapters).
 *
 * The EPC projection combines canonical ids into `:`-delimited draft logicalIds
 * (`xo:<decisionId>:<outcomeId>`, `re:<sourceDraftId>:<targetDraftId>`,
 * `n:<nodeId>`, …; see `projectToEpc.ts`). Because that scheme is positional,
 * a canonical id that itself contained a `:` could make two different id pairs
 * collapse onto one draft id — silently merging two distinct objects. The
 * duplicate-id refinement in `contract.ts` treats ids as opaque strings and does
 * not (yet) constrain their character set, so the safety guarantee lives at the
 * MINT site: every adapter that fabricates canonical ids should mint them over
 * the safe alphabet below, which excludes `:` (and every other delimiter the
 * projection reserves).
 *
 * Safe alphabet: `[A-Za-z0-9._-]`. ULIDs, UUIDs (without braces), and controlled
 * prefixes all satisfy it:
 *
 *   node_01J9XABCDEFGHJKMNPQRSTVWXYZ
 *   decision_6f9619ff-8b86-d011-b42d-00cf4fc964ff
 *   role_survey-section
 *
 * (A future step may fold this rule into the contract itself or escape ids
 * before combining them — see the note in `contract.ts`'s `allIdOccurrences`.)
 */

/** The safe canonical-id character set: letters, digits, dot, underscore, hyphen. */
export const CANONICAL_SAFE_ID_PATTERN = /^[A-Za-z0-9._-]+$/

/** True iff `id` is non-empty and contains only `[A-Za-z0-9._-]` (no `:`, space, slash, …). */
export function isSafeCanonicalId(id: string): boolean {
  return CANONICAL_SAFE_ID_PATTERN.test(id)
}

/**
 * Throw a clear error when `id` is not a safe canonical id. `context` names the
 * offending id in the message (e.g. `'canonical id prefix'`).
 */
export function assertSafeCanonicalId(id: string, context = 'canonical id'): void {
  if (!isSafeCanonicalId(id)) {
    throw new Error(
      `Unsafe ${context} ${JSON.stringify(id)}: canonical ids must match ` +
        `${String(CANONICAL_SAFE_ID_PATTERN)} (letters, digits, dot, underscore, hyphen) so the ` +
        'colon-delimited EPC draft ids derived from them stay unambiguous.'
    )
  }
}

/**
 * Injectable entropy source for {@link mintCanonicalId}. Must itself return a
 * safe-charset token (the minted id is re-checked, so an unsafe token fails
 * loudly). Deterministic-injectable so id allocation is reproducible under test.
 */
export type CanonicalIdEntropy = () => string

function defaultEntropy(): string {
  const globalCrypto = globalThis.crypto
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    // v4 UUID: hex + hyphens, entirely within the safe alphabet.
    return globalCrypto.randomUUID()
  }
  if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
    const bytes = globalCrypto.getRandomValues(new Uint8Array(16))
    let hex = ''
    for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
    return hex
  }
  throw new Error(
    'mintCanonicalId needs globalThis.crypto (randomUUID or getRandomValues); ' +
      'inject a CanonicalIdEntropy source where crypto is unavailable.'
  )
}

/**
 * Mint a fresh, collision-resistant, safe canonical id of the form
 * `<prefix>_<entropy>` — e.g. `mintCanonicalId('node')` → `node_<uuid>`. `prefix`
 * must be a safe token (a controlled kind label like `node`/`decision`/`role`);
 * `entropy` defaults to a v4 UUID. Both the prefix and the assembled id are
 * asserted safe, so a bad prefix or a bad injected entropy fails at the mint site
 * rather than surfacing later as a draft-id collision.
 */
export function mintCanonicalId(
  prefix: string,
  entropy: CanonicalIdEntropy = defaultEntropy
): string {
  assertSafeCanonicalId(prefix, 'canonical id prefix')
  const id = `${prefix}_${entropy()}`
  assertSafeCanonicalId(id, 'minted canonical id')
  return id
}
