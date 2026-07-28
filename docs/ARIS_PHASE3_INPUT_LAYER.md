# ARIS Phase 3 input-layer progress

Captured on Tuesday, July 28, 2026 from `feat/aris-only-studio`.

Phase 3 is now in progress. This slice establishes the first secure, lossless
AML/XML input-layer foundation that the ARIS shell can use without routing
through the legacy BPMN conversion stack.

## Implemented in this slice

- Added a custom XML tokenizer in [src/aris/source/xmlTokenizer.ts](/home/ahmed/Desktop/bpmn_tool/desktop/src/aris/source/xmlTokenizer.ts)
  - records declaration, doctype, start/end/empty tags, comments, CDATA,
    processing instructions, and text nodes
  - records line/column, byte offsets, and raw spans per token
  - rejects malformed nesting and duplicate attributes
  - preserves external DOCTYPE ids without resolving them
  - rejects external entity declarations and bounded nested entity expansion
- Added a browser worker boundary in:
  - [src/aris/source/xmlTokenizer.worker.ts](/home/ahmed/Desktop/bpmn_tool/desktop/src/aris/source/xmlTokenizer.worker.ts)
  - [src/aris/source/browserXmlTokenizer.ts](/home/ahmed/Desktop/bpmn_tool/desktop/src/aris/source/browserXmlTokenizer.ts)
  - [src/aris/source/xmlTokenizerWorkerProtocol.ts](/home/ahmed/Desktop/bpmn_tool/desktop/src/aris/source/xmlTokenizerWorkerProtocol.ts)
- Added an exact source-package loader in [src/aris/source/sourcePackage.ts](/home/ahmed/Desktop/bpmn_tool/desktop/src/aris/source/sourcePackage.ts)
  - preserves raw bytes
  - strict-decodes UTF-8
  - computes SHA-256
  - attaches the tokenized XML concrete-syntax result
- Wired [src/ArisApp.tsx](/home/ahmed/Desktop/bpmn_tool/desktop/src/ArisApp.tsx) through the new source-package loader so the production ARIS shell now opens AML/XML through the Phase 3 input layer instead of ad hoc string decoding

## Current security/behavior boundary

This is still an initial Phase 3 slice, not the full four-layer architecture.
What is true now:

- the ARIS shell preserves exact source bytes before any interpretation;
- XML tokenization runs through a browser worker when available;
- the tokenizer does not resolve external DTDs or external entities;
- real ARIS AML exports with `<!DOCTYPE AML SYSTEM "ARIS-Export.dtd">` remain
  loadable and preserved;
- malformed nesting and duplicate attributes now fail closed at the ARIS shell
  input boundary.

What is still pending for later Phase 3 work:

- a complete lossless XML concrete-syntax tree instead of token-stream-only
  capture;
- semantic ARIS source indexing;
- explicit unsupported-content accounting surfaced in the shell;
- integration with immutable source packages and revision history from Phase 4.

## Verification for this slice

- `npx vitest run --maxWorkers=2 --retry=0 src/aris/source/xmlTokenizer.test.ts src/ArisApp.test.tsx`
- `npm run check:aris-runtime-boundary`
- `npm run build:aris`
- `npm run test:aris:file-smoke`
