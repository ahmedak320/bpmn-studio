/**
 * Barrel for the `CanonicalProcessV1` package entry (Lane L-SCHEMA, Wave 18;
 * extended by L-PROJECT and L-VPKG, Wave 19).
 */

export * from './contract'
export * from './defaults'
export * from './ids'
export * from './jsonSchema'
export * from './projectToEpc'
export * from './findings'
export * from './findingMessages'
export * from './verificationPackage'
export * from './narrative'

// The pure AML serializer for a projected draft (no jsdom): lets the CLI's
// `project` command emit model.aml.xml without booting the canvas.
export { buildAmlFromArisAiDraft } from '../shell/arisAiCreate'
