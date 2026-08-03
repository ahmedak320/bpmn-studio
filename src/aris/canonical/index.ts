/**
 * Barrel for the `CanonicalProcessV1` package entry (Lane L-SCHEMA, Wave 18;
 * extended by L-PROJECT, Wave 19).
 *
 * L-PROJECT owns the projection, findings, and finding-message re-exports
 * below. The `verificationPackage`/`narrative` re-exports (L-VPKG) are added by
 * the orchestrator once those modules land — they do NOT exist yet, so they are
 * intentionally absent here (this file must reference only files that exist).
 */

export * from './contract'
export * from './jsonSchema'
export * from './projectToEpc'
export * from './findings'
export * from './findingMessages'
