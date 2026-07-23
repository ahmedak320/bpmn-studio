// OrbitPM "org pack" colour + label constants. These are the single source of
// truth for the DMT-style decorations painted by orgRenderer.ts and for any
// legend/swatch UI wired later by Phase B. Kept as a plain frozen record of hex
// strings so it is trivially importable from both the renderer (browser) and
// the pure unit tests (node) without pulling in any bpmn-js/DOM types.

export const PALETTE = {
  // Process "step" activity accents (green band + chevrons glyph).
  stepGreenBorder: '#1e9e62',
  stepGreenBand: '#157347',
  // "CC" (carbon-copy) styled activity.
  ccFill: '#f3d6e4',
  ccBorder: '#d63384',
  // Text-annotation "note" styling.
  noteFill: '#f7ecc0',
  noteBorder: '#d9c36b',
  // Owner chip below a shape.
  ownerFill: '#d9cba8',
  ownerBorder: '#b3a274',
  ownerText: '#3f3a2e',
  // Channel / trigger tags, one colour pair per channel kind.
  tagDmthubFill: '#dcd6f7',
  tagDmthubBorder: '#7b6fd0',
  tagEmailFill: '#dbe4f0',
  tagEmailBorder: '#6c8ebf',
  tagDataFill: '#f4d3d3',
  tagDataBorder: '#c0504d',
  // RACI role chip (single letter R/A/C/I).
  raciBg: '#ffffff',
  raciBorder: '#8a8a8a',
  // Inputs / base-information list box. A teal-cyan family deliberately
  // distinct from every other swatch: bluer than the step greens, greener than
  // the muted email blue, nowhere near the note straw or owner beige.
  inputFill: '#d3ecf2',
  inputBorder: '#0f7d90',
  inputText: '#0b5666',
  // Decision-basis tag on gateways / business-rule tasks. Amber ("it's a
  // rule") — hotter and more orange than the pale note yellow.
  basisFill: '#fce3bd',
  basisBorder: '#c47f17'
} as const

export type PaletteKey = keyof typeof PALETTE

/**
 * Human-readable tag label for each `orbitpm:channel` value. Also reused by the
 * trigger tag for the two channel-ish trigger kinds (dmthub / email).
 */
export const CHANNEL_TAG_LABELS: Record<string, string> = {
  dmthub: 'DMT HUB',
  email: 'EMAIL',
  data: 'DATA'
}
