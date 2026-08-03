# EPC projection reference

This document is the reference for the `CanonicalProcessV1` contract and the
deterministic canonical→EPC projection pipeline that turns it into a rendered
EPC diagram: schema, expansion rules, validation, determinism/versioning, and
the machine-readable findings artifact. It describes engine internals only —
`src/aris/canonical/**` and `src/aris/headless/**` — and matches the shipped
code, not just the design intent.

For how to consume this engine from an external repository (build, CLI
subprocess, artifact contract, review anchors, and the adapter payload
mapping), see [`ENTERPRISE_HANDOFF.md`](./ENTERPRISE_HANDOFF.md).

## Contents

1. [`CanonicalProcessV1`](#1-canonicalprocessv1)
2. [Expansion rules (canonical → EPC)](#2-expansion-rules-canonical--epc)
3. [Validation](#3-validation)
4. [Determinism + versioning](#4-determinism--versioning)
5. [Findings artifact](#5-findings-artifact)

---

## 1. `CanonicalProcessV1`

Source: `src/aris/canonical/contract.ts`. `CanonicalProcessV1` is the
notation-neutral, bilingual (English/Arabic), evidence-linked process
contract the engine accepts as input. It deliberately does not know about
EPC, BPMN, or any other notation: objects are events/activities/decisions/
roles/systems/information objects/controls, edges are sequence/conditional/
parallel/handoff/data-flow/exception-route, every citable object carries an
`id`, and every entity carries a `confidence`.

Every zod object schema is built with `z.strictObject(...).strict()` (unknown
keys are rejected), nothing has a `.default()` or coercion, and
`parseCanonicalProcess(raw: unknown): CanonicalParseResult` **never throws**
— it always returns `{ok: true, process}` or `{ok: false, issues}`, where each
issue carries a stable `code`, a `path`, and a `message`.

### Top-level shape

```ts
interface CanonicalProcessV1 {
  readonly version: 1
  readonly identity: CanonicalIdentity
  readonly nodes: readonly CanonicalNode[]
  readonly decisions: readonly CanonicalDecision[]
  readonly edges: readonly CanonicalEdge[]
  readonly roles: readonly CanonicalRole[]
  readonly systems: readonly CanonicalSystem[]
  readonly informationObjects: readonly CanonicalInformationObject[]
  readonly controls: readonly CanonicalControl[]
  readonly facts: readonly CanonicalFact[]
  readonly unknowns: readonly CanonicalUnknown[]
}
```

`nodes`, `decisions`, `edges`, `roles`, `systems`, `informationObjects`,
`controls`, and `facts` are the 8 top-level entity arrays that share **one
process-wide id namespace** (an id used in one array may not be reused in
another, and a `decisions[*].outcomes[*].id` joins this same namespace even
though outcomes are nested rather than top-level — see `duplicate-id`
below).

### `CanonicalText`

```ts
interface CanonicalText {
  readonly en?: string // min length 1
  readonly ar?: string // min length 1
}
```

At least one of `en`/`ar` is **required** (unlike `ArisAiLocalizedText` in
`src/aris/ai/contract.ts`, which allows both to be absent so a provider can
flag the gap with an uncertainty instead). A `CanonicalText` with neither
locale present is never valid, in any position it appears — use a
`CanonicalUnknown` of kind `'missing-translation'` to flag a missing locale
instead of omitting both.

### `CanonicalConfidence`

`'high' | 'medium' | 'low'`. Carried by `identity` and by every entity in the
8 top-level entity arrays. `CanonicalUnknown` is the one entity shape with no
`confidence` field — it records uncertainty about some other id, so it does
not itself carry a confidence rating.

### `CanonicalIdentity`

| Field            | Type                  | Required | Notes                                                                                                                                                                |
| ---------------- | --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `string` (min 1)      | yes      | The process's own id.                                                                                                                                                |
| `names`          | `CanonicalText`       | yes      |                                                                                                                                                                      |
| `purpose`        | `CanonicalText`       | no       | Milestone amendment. Feeds `buildVerificationPackage`'s `purpose` and the narrative's opening paragraph fallback.                                                    |
| `code`           | `string` (min 1)      | no       |                                                                                                                                                                      |
| `processVersion` | `string` (min 1)      | no       | A descriptive version string carried inside the canonical body — distinct from the render-time `sourceVersionId` passthrough (see [§4](#4-determinism--versioning)). |
| `confidence`     | `CanonicalConfidence` | yes      |                                                                                                                                                                      |

### `CanonicalNode`

`kind: CanonicalNodeKind` = `event` | `activity` | `decision` | `wait` | `handoff` | `exception`

| Field              | Type                  | Required | Notes                                                                                 |
| ------------------ | --------------------- | -------- | ------------------------------------------------------------------------------------- |
| `id`               | `string` (min 1)      | yes      |                                                                                       |
| `kind`             | `CanonicalNodeKind`   | yes      |                                                                                       |
| `names`            | `CanonicalText`       | yes      |                                                                                       |
| `description`      | `CanonicalText`       | no       |                                                                                       |
| `waitDetail`       | `CanonicalText`       | no       | Meaningful for `kind === 'wait'` only; the shape does not enforce this by refinement. |
| `targetProcessRef` | `string` (min 1)      | no       | Meaningful for `kind === 'handoff'` only; an opaque reference to another process.     |
| `factIds`          | `string[]`            | no       |                                                                                       |
| `confidence`       | `CanonicalConfidence` | yes      |                                                                                       |

### `CanonicalDecision` + `CanonicalDecisionOutcome`

```ts
interface CanonicalDecisionOutcome {
  readonly id: string
  readonly names: CanonicalText
  readonly targetNodeId: string
}
interface CanonicalDecision {
  readonly id: string
  readonly nodeId: string // must resolve to a declared node of kind 'decision'
  readonly criteria?: CanonicalText
  readonly outcomes: readonly CanonicalDecisionOutcome[] // min 2
  readonly factIds?: readonly string[]
  readonly confidence: CanonicalConfidence
}
```

Every `'decision'`-kind node must be referenced by **exactly one**
`decisions[]` entry (see `decision-node-unreferenced` /
`decision-node-multiple-references` below), and a decision node's outgoing
control flow is expressed **only** through its `decisions[].outcomes` — never
through a plain `sequence` edge (`decision-node-sequence-edge`).

### `CanonicalEdge`

`kind: CanonicalEdgeKind` = `sequence` | `conditional` | `parallel` | `handoff` | `data-flow` | `exception-route`

| Field          | Type                  | Required                                                   | Notes                                                        |
| -------------- | --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| `id`           | `string` (min 1)      | yes                                                        |                                                              |
| `kind`         | `CanonicalEdgeKind`   | yes                                                        |                                                              |
| `sourceNodeId` | `string` (min 1)      | yes                                                        |                                                              |
| `targetNodeId` | `string` (min 1)      | yes                                                        |                                                              |
| `condition`    | `CanonicalText`       | required iff `kind === 'conditional'`, forbidden otherwise | see `edge-condition-required` / `edge-condition-not-allowed` |
| `factIds`      | `string[]`            | no                                                         |                                                              |
| `confidence`   | `CanonicalConfidence` | yes                                                        |                                                              |

### `CanonicalRole`

`{id, names, unit?, nodeIds: string[], owner?: boolean, factIds?, confidence}`
— `owner: true` marks the process owner; more than one role may declare it
(the contract does not forbid multiple owners — `buildVerificationPackage`
picks the lowest-id one, see [`ENTERPRISE_HANDOFF.md`](./ENTERPRISE_HANDOFF.md)).

### `CanonicalSystem`

`{id, names, nodeIds: string[], factIds?, confidence}`.

### `CanonicalInformationObject`

`{id, names, inputToNodeIds: string[], outputOfNodeIds: string[], factIds?, confidence}`.

### `CanonicalControl`

`kind: CanonicalControlKind` = `policy` | `business-rule` | `requirement`.
`{id, names, kind, nodeIds: string[], factIds?, confidence}`.

### `CanonicalFact`

`{id, statement: CanonicalText, evidenceRefs: string[], confidence}` —
`evidenceRefs` are opaque IDs into the caller's own evidence store; the
engine never resolves or interprets them.

### `CanonicalUnknown`

`kind: CanonicalUnknownKind` = `missing-field` | `missing-translation` | `ambiguous-mapping` | `unclear-symbol` | `other`.
`{targetId, kind, field?, message: CanonicalText, factIds?}` — `targetId`
must resolve to **any** declared id anywhere in the process (identity, a
node, a decision or one of its outcomes, an edge, a role, a system, an
information object, a control, or a fact), not only a node id.

### Cross-reference integrity (12 stable issue codes)

Beyond per-field shape, one `z.superRefine()` on `CanonicalProcessV1Schema`
enforces cross-references. Every issue it raises (and `CanonicalText`'s own
emptiness check) carries a stable `code` via zod's custom-issue
`params.issueCode`, surfaced as `CanonicalParseIssue.code`:

| Issue code                          | Fires when                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `canonical-text-empty`              | A `CanonicalText` has neither `en` nor `ar`.                                                                                                                                                                                                                                                                                                                                               |
| `duplicate-id`                      | An id is reused across the 8 top-level entity arrays (`nodes`/`decisions`/`edges`/`roles`/`systems`/`informationObjects`/`controls`/`facts`) **or** a `decisions[*].outcomes[*].id` — outcome ids share the same process-wide id namespace (they become draft object ids in the projection, `xo:<decisionId>:<outcomeId>`), so a reused outcome id is a duplicate too, not a silent merge. |
| `dangling-node-reference`           | A node-id-shaped field does not resolve to a declared `nodes[].id`: edge endpoints, `decision.nodeId`/`outcome.targetNodeId`, `role`/`system`/`control.nodeIds[*]`, `informationObjects.*NodeIds[*]`.                                                                                                                                                                                      |
| `dangling-fact-reference`           | A `factIds[*]` entry does not resolve to a declared `facts[].id`.                                                                                                                                                                                                                                                                                                                          |
| `dangling-unknown-target`           | `unknowns[*].targetId` does not resolve to any declared id in the process.                                                                                                                                                                                                                                                                                                                 |
| `edge-condition-required`           | An edge of kind `'conditional'` has no `condition`.                                                                                                                                                                                                                                                                                                                                        |
| `edge-condition-not-allowed`        | An edge **not** of kind `'conditional'` carries a `condition`.                                                                                                                                                                                                                                                                                                                             |
| `decision-node-kind-mismatch`       | `decisions[*].nodeId` resolves to a node whose `kind` is not `'decision'`.                                                                                                                                                                                                                                                                                                                 |
| `decision-node-unreferenced`        | A node of kind `'decision'` is not referenced by any `decisions[]` entry.                                                                                                                                                                                                                                                                                                                  |
| `decision-node-multiple-references` | A node of kind `'decision'` is referenced by more than one `decisions[]` entry.                                                                                                                                                                                                                                                                                                            |
| `decision-node-sequence-edge`       | An edge of kind `'sequence'` has a decision node as its source (a decision's outgoing control flow must be expressed only through its `decisions[]` outcomes).                                                                                                                                                                                                                             |
| `decision-node-conditional-edge`    | An edge of kind `'conditional'` has a decision node as its source (a decision's branching must likewise be expressed only through its `decisions[]` outcomes — a conditional edge out of a decision would bypass the projected XOR and silently model a second, unlabeled split).                                                                                                          |

### Machine copy: `buildCanonicalProcessJsonSchema()`

Source: `src/aris/canonical/jsonSchema.ts`. `buildCanonicalProcessJsonSchema():
Record<string, unknown>` is a **hand-written** JSON Schema mirroring
`src/aris/ai/draftJsonSchema.ts`'s pattern — not a zod-to-json-schema
dependency (the campaign's zero-new-dependency target). Every object sets
`additionalProperties: false`; every `kind`/`confidence` field is `enum`-locked
to the same vocabulary constants `contract.ts` also feeds into `z.enum(...)`;
`required` arrays mirror the zod contract's optionality exactly.

One documented gap: JSON Schema has no first-class "at least one of these
optional keys" beyond `anyOf`, so `CanonicalText`'s "at least one of en/ar"
invariant is expressed as `anyOf: [{required: ['en']}, {required: ['ar']}]`
rather than folded into `required` (which stays empty there, matching
`Object.keys` optionality exactly).

This is the artifact a consumer without TypeScript/zod tooling (for example a
Python enterprise worker) can use to validate a payload before ever invoking
the engine. `jsonSchema.test.ts` drift-guards it two ways: every `enum` here
equals the vocabulary constant the zod contract also uses, and a structural
comparison of `required`/`properties` keys here against each zod object
shape's own keys/optionality.

---

## 2. Expansion rules (canonical → EPC)

Source: `src/aris/canonical/projectToEpc.ts`, `PROJECTION_VERSION = 1`.
`projectCanonicalToDraft(process: CanonicalProcessV1): CanonicalProjectionResult`
turns a notation-neutral canonical process into a fully-valid `ArisAiDraftV1`
(the same shape the studio's AI-generation path produces and validates — 12
object types / 17 connection types / 3 rule symbols; see
`src/aris/ai/contract.ts` and `src/aris/ai/typeValidation.ts`), which then
feeds the **existing** AML/import/layout/render pipeline unchanged:

```ts
interface CanonicalProjectionResult {
  readonly draft: ArisAiDraftV1
  readonly anchors: {
    readonly nodeByDraftId: Readonly<Record<string, string>> // draft object logicalId -> causing canonical id
    readonly edgeByDraftId: Readonly<Record<string, string>> // draft relation logicalId -> causing canonical id
  }
}
```

Because the draft's logical ids embed the canonical ids verbatim (see the
scheme below), and because ARIS ids are minted as `ObjDef.<logicalId>` /
`ObjOcc.<logicalId>` (`src/aris/shell/arisAiCreate.ts`), canonical ids survive
verbatim into the canvas element ids (`ObjOcc.<draftLogicalId>` /
`CxnOcc.<draftLogicalId>`) that the headless renderer anchors on — see
`data-epc-node`/`data-epc-edge` in [§4](#4-determinism--versioning) and the
review anchor contract in
[`ENTERPRISE_HANDOFF.md`](./ENTERPRISE_HANDOFF.md#4-review-anchor-contract).

### Draft logicalId scheme (BINDING — derived only from canonical ids, never random)

`<cid>` denotes a canonical id below. Every id is deterministic — no
`Date.now`/`Math.random`/random ids anywhere in the projection:

- primary node — `n:<cid>`
- decision rule — `x:<decisionId>` (cid = decision id)
- outcome event — `xo:<decisionId>:<outcomeId>`
- parallel split (AND) — `ps:<fanNodeId>`
- parallel merge (AND) — `pm:<fanNodeId>`
- exception rule (XOR) — `xe:<exceptionNodeId>`
- exception event — `xev:<exceptionNodeId>`
- alternation filler event — `fe:<edge>` / filler function — `ff:<edge>`
- role satellite — `r:<roleId>`
- system satellite — `s:<systemId>`
- information-object satellite — `io:<infoId>`
- control satellite — `c:<controlId>`
- placeholder model — `m:<targetProcessRef>` (the primary model is `m:<processId>`)
- primary edge relation — `e:<edgeId>`
- synthesized relation — `re:<sourceDraftId>:<targetDraftId>`
- inline attribute — `a:<ownerDraftId>:<attributeType>` (the process owner's model attribute is `a:<roleId>:AT_PERS_RESP`)
- linked-model assignment — `lm:<handoffNodeId>`

(The last two forms — inline attribute and linked-model assignment ids — are
implementation detail beyond the lane brief's summary table; they are
included here because they are load-bearing for reproducing exact draft ids
from canonical ids.)

### Connection-type selection (endpoint-driven)

Control-flow relations pick their `connectionType` from the endpoint object
types, mirroring `src/aris/ai/promptBuilder.ts`'s cheat sheet:

| Source type | Target type | `connectionType`  |
| ----------- | ----------- | ----------------- |
| `OT_EVT`    | `OT_FUNC`   | `CT_ACTIV_1`      |
| `OT_RULE`   | `OT_FUNC`   | `CT_ACTIV_1`      |
| `OT_FUNC`   | `OT_EVT`    | `CT_CRT_1`        |
| `OT_FUNC`   | `OT_RULE`   | `CT_LEADS_TO_1`   |
| `OT_RULE`   | `OT_EVT`    | `CT_LEADS_TO_2`   |
| `OT_EVT`    | `OT_RULE`   | `CT_IS_EVAL_BY_1` |

`OT_FUNC → OT_FUNC` and `OT_EVT → OT_EVT` never survive as a direct relation
— they are always spliced by alternation completion (below) before the draft
is assembled.

### The expansion table (every row implemented in `projectToEpc.ts`)

| Canonical                                                                     | EPC projection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event` node                                                                  | `OT_EVT`/`ST_EV`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `activity` node                                                               | `OT_FUNC`/`ST_FUNC`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `wait` node                                                                   | `OT_EVT`/`ST_EV`; `waitDetail` → draft attribute `AT_DESC` with values `{en: 'wait: '+detail.en, ar: 'انتظار: '+detail.ar}` (whichever locales exist)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `handoff` node                                                                | `OT_FUNC` + `symbolType:'ST_PRCS_IF'`; when `targetProcessRef` is set, ALSO emit a placeholder `ArisAiModel` `{logicalId:'m:'+ref, modelType:'MT_EEPC', names: from ref}` + `ArisAiAssignment {assignmentType:'linked-model', objectLogicalId, assignedModelLogicalId:'m:'+ref}` (satisfies `epc.linkedModel.danglingReference`)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `decision` node + its `decisions[]` entry                                     | the decision node itself → `OT_FUNC`/`ST_FUNC` (the deciding step; `criteria` → `AT_DESC` attribute); then `OT_RULE`/`ST_OPR_XOR_1` `x:<id>`; per outcome an `OT_EVT` `xo:<id>:<oid>` named by the outcome label (en/ar); relations: decision-func → rule (`CT_LEADS_TO_1`), rule → each outcome event (`CT_ACTIV_1`, `names` = outcome label — belt-and-braces for `epc.rule.unlabeledDecisionBranch`), outcome event → projection of `outcome.targetNodeId` (`CT_ACTIV_1`)                                                                                                                                                                                                                                                                               |
| `parallel` edges (≥2 out of one node)                                         | insert `OT_RULE`/`ST_OPR_AND_1` `ps:<nodeId>` after the node; node→ps, ps→each target. ≥2 parallel edges INTO one node: `pm:<nodeId>` before it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `exception` node + `exception-route` edge                                     | at the route's source: `OT_RULE`/`ST_OPR_XOR_1` `xe:<excId>` spliced into the outgoing flow; branch A continues the normal flow, branch B → `OT_EVT` `xev:<excId>` named from the exception node's names → then to the route's target if one exists, else it IS the (rejected) end event                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `sequence` / `handoff` edge                                                   | control-flow relation `CT_ACTIV_1` when source is `OT_EVT`→func, `CT_CRT_1` when func→event, `CT_LEADS_TO_1` into/out of rules (picked by endpoint types exactly as the connection-type table above); `CanonicalEdge` has no `names` field, so neither kind synthesizes a relation name of its own (contrast the `conditional` row below, whose `condition` text is carried onto the relation)                                                                                                                                                                                                                                                                                                                                                             |
| `conditional` edge                                                            | a `conditional` edge's REQUIRED `condition` text is carried onto the emitted control-flow relation as its `names` — preserved in the draft/findings data (and read by the EPC validator when checking `epc.rule.unlabeledDecisionBranch` on any XOR split the edge participates in); sourced from a **decision** node it is instead a validation error (`decision-node-conditional-edge` — a decision's branching must be expressed only through its `decisions[]` outcomes). **Limitation:** ARIS convention renders no relation-name caption for a connection, so this condition text does **not** appear as a visible label in the AML/SVG — model a _visible_ branch condition via a `decision` + named `outcomes` (which become named events) instead |
| `data-flow` edge via `informationObjects`                                     | `OT_INFO_CARR` `io:<id>`; `inputToNodeIds` → `CT_IS_INP_FOR` (info→func); `outputOfNodeIds` → `CT_HAS_OUT` (func→info)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `roles`                                                                       | `OT_PERS_TYPE` `r:<id>` + `CT_EXEC_1` (role→func) per `nodeIds` entry; `owner:true` additionally emits attribute `AT_PERS_RESP` on the model carrying the role's names                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `systems`                                                                     | `OT_APPL_SYS` `s:<id>` + `CT_SUPP_3` per node                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `controls`                                                                    | kind `policy`→`OT_POLICY` + `CT_AFFECTS`; `business-rule`→`OT_BUSINESS_RULE` + `CT_IS_EVAL_BY_1`; `requirement`→`OT_REQUIREMENT` + `CT_REFS_TO_2`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| facts / unknowns                                                              | `facts` referenced by an entity's `factIds` → the entity's `evidence` string = comma-joined sorted fact ids; every canonical unknown → `ArisAiUncertainty` (kind maps 1:1 — the enum was mirrored by design) targeting the projected draft id                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **alternation completion** (final deterministic pass over the assembled flow) | for every flow relation func→func (except `CT_IS_PREDEC_OF_1`): splice `OT_EVT` `fe:<edgeId>` named EN `<source en name> completed` / AR `اكتمل <source ar name>` (omit a locale when the source lacks it); for evt→evt: splice `OT_FUNC` `ff:<edgeId>` named EN `Handle <target en name>` / AR `معالجة <target ar name>`                                                                                                                                                                                                                                                                                                                                                                                                                                  |

`suggestedOrder`: depth-first from the start event over canonical
`sequence`/`conditional`/`parallel`/`handoff`/`exception-route` edges,
children visited in edge-array order, synthesized nodes ordered immediately
after their trigger — assigned `0..n`. Satellites get no order (they are not
flow nodes). `projectCanonicalToDraft` sets this explicitly (rather than
leaving array order implicit) so the layout spine is stable regardless of
how the caller ordered the source arrays.

### Recorded implementation choices (from the `projectToEpc.ts` module header)

Five places where the shipped projection picks one of several
equally-EPC-legal encodings; none change validation outcomes (each is a
listed `FLOW_CONNECTION_TYPES` entry, or a satellite relation outside the
control-flow graph entirely):

1. Decision `rule → outcome event` uses `CT_ACTIV_1` (the expansion table,
   verbatim) rather than the endpoint table's `RULE→EVT` pairing
   `CT_LEADS_TO_2`. Both are accepted as control flow for `RULE→EVT`, so the
   XOR is still seen as a split by `checkLabeledDecisionBranches` either way.
2. Roles use `CT_EXEC_1` (expansion table), not the endpoint-table's
   `CT_EXEC_2`. A role relation is a satellite (never control flow), so this
   has no validation impact.
3. Information objects use `CT_IS_INP_FOR` (input) / `CT_HAS_OUT` (output)
   per the expansion table — both satellite relations.
4. Alternation filler ids: for a spliced **primary** canonical edge
   (relation `e:<cid>`) the filler is `fe:<cid>`/`ff:<cid>` exactly as the
   scheme states; for a spliced **synthesized** flow relation (which has no
   canonical edge id of its own) the filler instead carries the full
   relation logicalId (`fe:re:...`/`ff:re:...`) to guarantee uniqueness.
   Filler `confidence` is always `'high'` (a purely structural, deterministic
   node).
5. A `sequence`/`handoff` edge directly between two functions is **never**
   emitted as a raw `CT_IS_PREDEC_OF_1` tuple; it is always spliced with an
   `fe:` filler event so the projection stays a properly-alternating EEPC.
   `CT_IS_PREDEC_OF_1` remains the alternation-exempt code (mirroring
   `checkAlternation`'s own exemption for it) but the projection itself
   never produces it.

---

## 3. Validation

Source: `src/aris/canonical/findings.ts`,
`validateProjectedDraft(result, canonical): Promise<EpcProjectionFindings>`.
This is the **pre-render structural gate**: it runs `validateArisAiDraft`
over the projected draft first (a shape-level gate — malformed drafts never
reach the EPC rule engine), then, for every drafted model that contains at
least one flow-type object (`OT_EVT`/`OT_FUNC`/`OT_RULE`), builds an
`EpcGraph` using the **same adapter shape** `src/aris/ai/epcSemantics.ts`'s
`adapterModelFor` uses (copied into `findings.ts`, never imported — this
module must not pull in the AI-repair wrapper) and runs the shared
`validateEpcGraph` from `src/aris/epc/validate.ts`.

A draft-shape failure surfaces as one `EpcProjectionFinding` per
`validateArisAiDraft` finding, with `ruleId` set to
`aris.projection.draftInvalid:<code>`, `severity: 'error'`, and `messageKey`
the fixed guard key `aris.projection.draftInvalid` (`PROJECTION_DRAFT_INVALID_KEY`,
exported from `findings.ts`) — its `messageEn`/`messageAr` both carry the
same underlying validation-detail text (a passthrough, not a bilingual
message-table entry, since a malformed draft is an engine-internal defect
rather than an authoring mistake with a translated user message).

### The 11-rule table (`src/aris/epc/validate.ts`, verbatim from its own Section 14.1 comment)

| #   | Rule id                             | Function                           | `messageKey`                                  | Severity  | New this campaign |
| --- | ----------------------------------- | ---------------------------------- | --------------------------------------------- | --------- | ----------------- |
| 1   | `epc.alternation`                   | `checkAlternation`                 | `aris.epc.finding.alternationViolation`       | error     | no                |
| 2   | `epc.startEnd.missingStart`         | `checkStartEndCompleteness`        | `aris.epc.finding.missingStartEvent`          | error     | no                |
| 3   | `epc.startEnd.missingEnd`           | `checkStartEndCompleteness`        | `aris.epc.finding.missingEndEvent`            | error     | no                |
| 4   | `epc.rule.splitMergeConflict`       | `checkRuleSplitMergeConflict`      | `aris.epc.finding.ruleSplitMergeConflict`     | error     | no                |
| 5   | `epc.event.decisionViolation`       | `checkEventPrecedesDecisionSplit`  | `aris.epc.finding.eventPrecedesDecisionSplit` | error     | no                |
| 6   | `epc.connectivity.orphanNode`       | `checkConnectedComponentIntegrity` | `aris.epc.finding.orphanNode`                 | warning   | no                |
| 7   | `epc.rule.unrecognizedSymbol`       | `checkRuleSymbolRecognized`        | `aris.epc.finding.unrecognizedRuleSymbol`     | warning   | no                |
| 8   | `epc.connection.missingType`        | `checkTypedConnections`            | `aris.epc.finding.missingConnectionType`      | error     | no                |
| 9   | `epc.linkedModel.danglingReference` | `checkLinkedModelAssignments`      | `aris.epc.finding.danglingLinkedModel`        | error     | no                |
| 10  | `epc.rule.unlabeledDecisionBranch`  | `checkLabeledDecisionBranches`     | `aris.epc.finding.unlabeledDecisionBranch`    | **error** | **yes**           |
| 11  | `epc.startEnd.unreachableEnd`       | `checkEndReachability`             | `aris.epc.finding.unreachableEnd`             | **error** | **yes**           |

What each rule checks, in one line (keyed by the `Rule id` column above):

- **`epc.alternation`** — two directly-connected occurrences of the same
  type (function/function or event/event) is a violation; a rule must sit
  between them (exception: DMT's exact `CT_IS_PREDEC_OF_1` Function→Function
  tuple).
- **`epc.startEnd.missingStart`** / **`epc.startEnd.missingEnd`** — a model
  must declare at least one start event (in-degree 0) and at least one end
  event (out-degree 0); existence only, not reachability (see
  `epc.startEnd.unreachableEnd` below).
- **`epc.rule.splitMergeConflict`** — a rule with both >1 incoming and >1
  outgoing flow edges is ambiguous; split and merge must be separate rules.
- **`epc.event.decisionViolation`** — an event must never be followed
  directly by an XOR/OR rule that itself splits (out-degree > 1); a decision
  belongs to a rule, not an event. AND splits are exempt (a parallel fork
  does not choose between alternatives).
- **`epc.connectivity.orphanNode`** — a control-flow node
  (function/event/rule) stranded outside the model's largest connected
  component.
- **`epc.rule.unrecognizedSymbol`** — an `OT_RULE` whose symbol does not
  classify as AND/OR/XOR.
- **`epc.connection.missingType`** — every connection occurrence must carry
  a non-empty `connectionType`.
- **`epc.linkedModel.danglingReference`** — a node's `linkedModelIds` must
  resolve to a model that actually exists (checked only when the caller
  supplies `knownModelIds`).
- **`epc.rule.unlabeledDecisionBranch`** _(new)_ — every outgoing branch of
  a deciding XOR/OR rule (out-degree ≥ 2) must be labeled: either the
  outgoing relation carries a non-empty name in some locale, or its target
  is an `OT_EVT` with a non-empty name in some locale (how the projection
  itself labels outcomes). AND splits are exempt.
- **`epc.startEnd.unreachableEnd`** _(new)_ — from every start event, a
  forward control-flow BFS must reach some end event. Skipped entirely when
  the model has zero start or zero end events (`missingStart`/`missingEnd`
  above already cover that case — this avoids double-reporting).

### Structural validation BEFORE rendering (ordering guarantee)

`src/aris/headless/render.ts`'s `renderCanonicalProcess` runs the pipeline in
this fixed order, and the structural gate runs strictly before any canvas is
constructed:

1. `parseCanonicalProcess` — a shape failure returns
   `{ok: false, reason: 'parse', issues}` immediately.
2. `projectCanonicalToDraft` — pure, always succeeds for a parsed
   `CanonicalProcessV1`.
3. `validateProjectedDraft` — **the gate**. Any error-severity finding
   returns `{ok: false, reason: 'validation', findings}` **without
   constructing a DOM at all**.
4. Only on a clean gate: draft → AML → tokenize → semantic index → working
   document → jsdom boot → canvas create → clean layout → anchor stamping →
   SVG capture.

`render.test.ts` proves this directly: under the plain Node environment (no
pre-existing DOM), a structurally-invalid input returns
`{ok: false, reason: 'validation', ...}` while asserting
`globalThis.document` is **still `undefined`** afterward — the gate really
does short-circuit before any jsdom construction.

The two new rules also surface in the live studio product beyond this
projection artifact (authorized product change): the EPC validation rail
(`src/aris/shell/arisValidationFindings.ts`'s `EPC_RULE_GAP_KINDS`), the gap
scanner, and the AI-generation repair turns (`src/aris/ai/epcSemantics.ts`'s
`EPC_RULE_MESSAGES`), plus the two new `aris.epc.finding.*` keys registered
in `src/i18n/dictionaries.ts` (English + Arabic) — the same `validateEpcGraph`
function backs all of these surfaces and this projection's findings artifact.

---

## 4. Determinism + versioning

No `Date.now`, `Math.random`, or `crypto.getRandomValues`-derived id appears
anywhere in the projection, findings, verification-package, narrative, or
render modules. Every draft id derives only from canonical ids via the
logicalId scheme in [§2](#2-expansion-rules-canonical--epc); `suggestedOrder`
is assigned explicitly from a depth-first spine rather than left to
incidental array order.

**Same canonical input + same engine version ⇒ byte-identical output**, for
every artifact the engine produces:

- the projected draft, compared via `canonicalJsonText` (sorted-key JSON
  text, `src/aris/packages/canonicalJson.ts`);
- the generated AML XML (`buildAmlFromArisAiDraft(...).xml`);
- the captured SVG markup (`renderCanonicalProcess(...).svg`) — pinned in
  `render.test.ts` by a committed SHA-256 snapshot constant, so a byte
  change without an intended cause is caught as a regression, not silently
  re-snapshotted;
- the findings JSON (`EpcProjectionFindings`).

One specific determinism hazard is neutralized deliberately: the live
diagram-js renderer mints caption clip-path ids from a module-global counter,
so two renders in the _same_ Node process could otherwise disagree with a
fresh process's first render. `renderCanonicalProcess` renumbers those ids to
a deterministic first-appearance sequence (`stabilizeCaptionClipIds`) after
capture — the ids are internal, non-semantic plumbing (they anchor nothing;
`data-epc-*` attributes are untouched by this step).

### Version counters, the input hash, and the passthrough version id

| Constant / field                                          | Source                               | Value     | Bump when…                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CANONICAL_SCHEMA_VERSION` / `CanonicalProcessV1.version` | `src/aris/canonical/contract.ts`     | `1`       | The `CanonicalProcessV1` shape itself changes in a breaking way.                                                                                                                                                                                                                                                             |
| `PROJECTION_VERSION`                                      | `src/aris/canonical/projectToEpc.ts` | `1`       | The canonical→EPC expansion rules themselves change (a table row, the logicalId scheme, or the alternation templates) in a way that could change the emitted draft/AML for the same input. Mirrored into `EpcProjectionFindings.projectionVersion` and `HeadlessRenderMetadata.projectionVersion`.                           |
| `EPC_ENGINE_VERSION`                                      | `src/aris/headless/version.ts`       | `'0.1.0'` | **Any** change that can move the render pipeline's output bytes — layout, renderer, projection, canonical schema, or a dependency bump. Tracks `packages/epc-engine/package.json`'s own `version` field. Bumping it is the explicit, reviewed "engine changed" signal that also invalidates the committed SVG snapshot hash. |

Two further values are not version counters but are part of the same
metadata contract:

- **`inputSha256`** — SHA-256 (lowercase hex, Web Crypto `crypto.subtle`) of
  `canonicalJsonBytes(process)` (the sorted-key JSON text plus a trailing
  newline, both part of the hashed content). Recomputed on every call;
  identical canonical input ⇒ identical hash, so a consumer can confirm two
  artifacts came from the same input without re-diffing the whole process.
- **`sourceVersionId`** _(optional)_ — the caller's own process-version id
  (for example `v001`/`v002`/`v003`), passed to
  `renderCanonicalProcess(process, {sourceVersionId})` **verbatim**. The
  engine never computes, increments, or interprets it — determinism holds
  because it is an explicit input, exactly like the canonical process
  itself. See the adapter mapping in
  [`ENTERPRISE_HANDOFF.md`](./ENTERPRISE_HANDOFF.md#6-adapter-payload-mapping).

### The SVG root metadata attributes

`renderCanonicalProcess` stamps these onto the live SVG root **before**
capture (so the exported clone carries them), then strips them from the live
root afterward. Four are always present; the fifth is present only when the
caller supplies `sourceVersionId`:

| Attribute                     | Always present?                                     | Value                             |
| ----------------------------- | --------------------------------------------------- | --------------------------------- |
| `data-epc-engine-version`     | yes                                                 | `EPC_ENGINE_VERSION`              |
| `data-epc-schema-version`     | yes                                                 | `"1"`                             |
| `data-epc-projection-version` | yes                                                 | `"1"` (`PROJECTION_VERSION`)      |
| `data-epc-input-sha256`       | yes                                                 | the SHA-256 hex described above   |
| `data-epc-source-version`     | **only when `options.sourceVersionId` is supplied** | the caller's version id, verbatim |

`HeadlessRenderMetadata` (the object returned alongside `svg`, and written by
the CLI as the `metadata.json` sidecar — see
[`ENTERPRISE_HANDOFF.md`](./ENTERPRISE_HANDOFF.md#3-artifactmetadata-contract))
mirrors the same fields: `engineVersion`, `schemaVersion: 1`,
`projectionVersion: 1`, `inputSha256`, `modelId`, and `sourceVersionId?`.

---

## 5. Findings artifact

Source: `src/aris/canonical/findings.ts`.

```ts
interface EpcProjectionFinding {
  readonly ruleId: string
  readonly severity: 'error' | 'warning'
  readonly messageKey: string // an aris.epc.finding.* key, or aris.projection.draftInvalid
  readonly messageEn: string
  readonly messageAr: string
  readonly canonicalNodeIds: readonly string[]
  readonly canonicalEdgeIds: readonly string[]
  readonly draftNodeIds: readonly string[]
  readonly draftEdgeIds: readonly string[]
}
interface EpcProjectionFindings {
  readonly schemaVersion: 1
  readonly projectionVersion: 1
  readonly inputSha256: string // sha256 hex of canonicalJsonBytes(process)
  readonly ok: boolean // no error-severity findings
  readonly findings: readonly EpcProjectionFinding[]
}
```

`ok` is `findings.every((f) => f.severity !== 'error')` — an artifact can be
`ok: true` while still carrying **warning**-severity findings (rules 6 and 7
in the table above); only an **error**-severity finding flips `ok` to `false`
and, in the headless render/CLI, blocks the render.

**Bilingual messages.** `src/aris/canonical/findingMessages.ts` carries its
own EN + AR string tables keyed by every `aris.epc.finding.*` `messageKey`
`validateEpcGraph` can produce — a deliberate duplication of
`src/i18n/dictionaries.ts`'s own copy, because this artifact is read
standalone by consumers outside the studio's i18n runtime (the enterprise
portal, the CLI). The two tables are drift-tested against each other.
`{param}` interpolation follows the exact convention `t()` uses: `{name}` is
replaced by `params[name]`, and an unmatched token is left verbatim as
`{name}`. An unknown `messageKey` degrades to returning the key itself in
both locales — never throws, never empty.

**Canonical-id anchoring.** Every underlying `EpcFinding`'s `nodeIds`/`edgeIds`
(draft-level ids) are mapped back through the projection's anchor tables
(`nodeByDraftId`/`edgeByDraftId`) into `canonicalNodeIds`/`canonicalEdgeIds`
(de-duplicated); the original draft-level ids are kept alongside as
`draftNodeIds`/`draftEdgeIds` for debugging. This is what lets a consumer
show a finding directly against the same logicalId a `data-epc-node`/
`data-epc-edge` SVG anchor or a `buildVerificationPackage` entry uses — one
id space across the findings artifact, the rendered SVG, and the
verification package.

**Unprojected-edge warning.** Beyond the draft-validation and `validateEpcGraph`
findings above, `validateProjectedDraft` also walks every `canonical.edges[]`
entry and emits a `messageKey: 'aris.projection.unprojectedEdge'`
(`PROJECTION_UNPROJECTED_EDGE_KEY`, `src/aris/canonical/findingMessages.ts`),
`severity: 'warning'` finding for any edge whose id never appears as a
`cause` in either anchor table — i.e. an edge that produced no draft
control-flow relation at all. In the shipped projection this catches a
`data-flow` edge (never control flow — the projection instead derives
data-flow relations from `informationObjects[].inputToNodeIds`/
`outputOfNodeIds` directly, so a `data-flow`-kind edge's own id is never a
relation `cause`) and an `exception-route` edge whose source is **not** an
`exception`-kind node (so no `xe:` XOR splice ever consumes it), plus any
future edge kind the projection does not yet handle — so no declared
canonical edge is ever silently dropped from the artifact, even when the
rendered diagram cannot show it. `canonicalEdgeIds` is the single edge id,
`canonicalNodeIds` its (de-duplicated) source/target node ids, and
`draftNodeIds`/`draftEdgeIds` are both empty (nothing was projected to anchor
to); findings are emitted in canonical edge-array order for determinism. This
messageKey lives in its own `PROJECTION_FINDING_MESSAGES_EN`/`_AR` table in
`findingMessages.ts` — engine-internal, and distinct from both the 11
`aris.epc.finding.*` rule keys ([§3](#3-validation)) and the 12 canonical
contract issue codes ([§1](#1-canonicalprocessv1)). Like the existing
`aris.projection.draftInvalid` guard key, it is not registered in
`src/i18n/dictionaries.ts`. Being warning-severity, it never by itself flips
`ok` to `false`.

`inputSha256` is computed once per `validateProjectedDraft` call over the
**canonical** input (not the draft), so it can be compared directly against
the sidecar `metadata.json` / SVG `data-epc-input-sha256` to prove both came
from the same canonical document.

---

See also: [`ENTERPRISE_HANDOFF.md`](./ENTERPRISE_HANDOFF.md) for consumption
(build, packaging, CLI subprocess/Azure worker contract), the artifact and
review-anchor contracts, `buildVerificationPackage`'s field reference, and
the enterprise adapter payload mapping. The repository README's "EPC engine
as a service" section is the top-level pointer to both documents.
