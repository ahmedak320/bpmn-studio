/**
 * Hand-written `CanonicalProcessV1` fixtures (implementation plan Lane
 * L-FIXTURES, Wave 18; milestone-amendment bullet at plan line 27).
 *
 * Plain, frozen, typed TypeScript objects — NOT JSON files, so they stay
 * type-checked against `./contract` and so `vitest`'s `src/**` include picks
 * up their sibling test (`fixtures.test.ts`). Every VALID_CANONICAL_* fixture
 * is a genuinely well-formed `CanonicalProcessV1` that must pass every
 * cross-reference refinement in `contract.ts`. Every INVALID_CANONICAL_*
 * fixture is typed `unknown` (matching `parseCanonicalProcess(raw: unknown)`)
 * and is broken in EXACTLY ONE intended way, isolated to the smallest
 * structure that reproduces it — see `fixtures.test.ts` for the
 * fixture -> expected issue `code`/`path` table that pins down the reason.
 *
 * Downstream consumers (L-PROJECT / L-EPC-RULES, Wave 19+) reuse
 * `VALID_CANONICAL_FULL` as the canonical "one of everything" example; its
 * exact shape is therefore deliberately explicit and richly cross-linked
 * rather than terse.
 */

import type { CanonicalProcessV1 } from './contract'

// ---------------------------------------------------------------------------
// Deep-freeze helper (fixtures must be frozen; no runtime mutation possible)
// ---------------------------------------------------------------------------

/** Deep-freezes a plain object/array tree in place, then returns it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.getOwnPropertyNames(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

// ---------------------------------------------------------------------------
// VALID_CANONICAL_MINIMAL — start event -> activity -> end event
// ---------------------------------------------------------------------------

/**
 * The smallest realistic process: one linear flow, one role, two evidenced
 * facts, one unknown gap, bilingual (en+ar) everywhere.
 */
export const VALID_CANONICAL_MINIMAL: CanonicalProcessV1 = deepFreeze({
  version: 1,
  identity: {
    id: 'proc-minimal',
    names: { en: 'Minimal Process', ar: 'عملية بسيطة' },
    confidence: 'high'
  },
  nodes: [
    { id: 'n-start', kind: 'event', names: { en: 'Start', ar: 'بداية' }, confidence: 'high' },
    {
      id: 'n-task',
      kind: 'activity',
      names: { en: 'Perform task', ar: 'تنفيذ المهمة' },
      factIds: ['f-1'],
      confidence: 'medium'
    },
    { id: 'n-end', kind: 'event', names: { en: 'End', ar: 'نهاية' }, confidence: 'high' }
  ],
  decisions: [],
  edges: [
    {
      id: 'e-1',
      kind: 'sequence',
      sourceNodeId: 'n-start',
      targetNodeId: 'n-task',
      confidence: 'high'
    },
    {
      id: 'e-2',
      kind: 'sequence',
      sourceNodeId: 'n-task',
      targetNodeId: 'n-end',
      confidence: 'high'
    }
  ],
  roles: [
    {
      id: 'r-doer',
      names: { en: 'Doer', ar: 'المنفذ' },
      nodeIds: ['n-task'],
      factIds: ['f-2'],
      confidence: 'medium'
    }
  ],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [
    {
      id: 'f-1',
      statement: { en: 'The task takes about 10 minutes.', ar: 'تستغرق المهمة حوالي 10 دقائق.' },
      evidenceRefs: ['ev-min-1'],
      confidence: 'medium'
    },
    {
      id: 'f-2',
      statement: {
        en: 'The Doer role was confirmed by the process owner.',
        ar: 'تم تأكيد دور المنفذ من قبل مالك العملية.'
      },
      evidenceRefs: ['ev-min-2'],
      confidence: 'high'
    }
  ],
  unknowns: [
    {
      targetId: 'r-doer',
      kind: 'missing-field',
      field: 'unit',
      message: {
        en: 'The organizational unit owning the Doer role is not specified.',
        ar: 'الوحدة التنظيمية المالكة لدور المنفذ غير محددة.'
      }
    }
  ]
})

// ---------------------------------------------------------------------------
// VALID_CANONICAL_FULL — one process exercising every CanonicalNodeKind
// ---------------------------------------------------------------------------

/**
 * "IT Incident Escalation" — one process exercising every `CanonicalNodeKind`
 * (event, activity x3, decision, wait, handoff, exception) plus a parallel
 * fan-out/fan-in and an exception-route edge, 2 roles (one `owner:true` with
 * `unit`), 2 systems, 2 information objects (one input-only, one
 * output-only), 2 controls (policy + business-rule), 6 evidenced facts, 2
 * unknowns, mixed confidence values, bilingual (en+ar) throughout.
 *
 * Flow: start -> log -> triage (decision: high/low severity).
 *   Low severity  -> resolved (end).
 *   High severity -> investigate, which fans OUT in parallel to notify and
 *     wait, which fan back IN in parallel to handoff (vendor escalation) ->
 *     exception (SLA breach), which either exception-routes to a rejected
 *     end event, or sequences to a resolved (high-severity) end event.
 */
export const VALID_CANONICAL_FULL: CanonicalProcessV1 = deepFreeze({
  version: 1,
  identity: {
    id: 'proc-full',
    names: { en: 'IT Incident Escalation', ar: 'تصعيد حادثة تقنية المعلومات' },
    purpose: {
      en: 'Resolve reported IT incidents within the agreed service levels.',
      ar: 'حل حوادث تقنية المعلومات المبلغ عنها ضمن مستويات الخدمة المتفق عليها.'
    },
    code: 'ITIL-INC',
    processVersion: 'v003',
    confidence: 'high'
  },
  nodes: [
    {
      id: 'n-start',
      kind: 'event',
      names: { en: 'Incident reported', ar: 'تم الإبلاغ عن الحادثة' },
      confidence: 'high'
    },
    {
      id: 'n-log',
      kind: 'activity',
      names: { en: 'Log incident', ar: 'تسجيل الحادثة' },
      factIds: ['f-1'],
      confidence: 'high'
    },
    {
      id: 'n-triage',
      kind: 'decision',
      names: { en: 'Assess severity', ar: 'تقييم مستوى الخطورة' },
      confidence: 'high'
    },
    {
      id: 'n-investigate',
      kind: 'activity',
      names: { en: 'Investigate root cause', ar: 'التحقيق في السبب الجذري' },
      factIds: ['f-2'],
      confidence: 'medium'
    },
    {
      id: 'n-notify',
      kind: 'activity',
      names: { en: 'Notify stakeholders', ar: 'إخطار أصحاب المصلحة' },
      confidence: 'medium'
    },
    {
      id: 'n-wait',
      kind: 'wait',
      names: { en: 'Await vendor patch', ar: 'انتظار تصحيح المورّد' },
      waitDetail: {
        en: 'Blocked until the vendor ships a fix.',
        ar: 'متوقف حتى يصدر المورّد إصلاحاً.'
      },
      factIds: ['f-5'],
      confidence: 'low'
    },
    {
      id: 'n-handoff',
      kind: 'handoff',
      names: {
        en: 'Hand off to vendor escalation process',
        ar: 'التسليم إلى عملية تصعيد المورّد'
      },
      targetProcessRef: 'proc-vendor-escalation-v1',
      confidence: 'medium'
    },
    {
      id: 'n-exception',
      kind: 'exception',
      names: { en: 'SLA breach exception', ar: 'استثناء خرق اتفاقية مستوى الخدمة' },
      description: {
        en: 'Raised when an incident remains open past the SLA threshold.',
        ar: 'يُثار عند بقاء الحادثة مفتوحة بعد تجاوز حد اتفاقية مستوى الخدمة.'
      },
      factIds: ['f-3'],
      confidence: 'high'
    },
    {
      id: 'n-rejected-end',
      kind: 'event',
      names: { en: 'Incident escalation rejected', ar: 'رفض تصعيد الحادثة' },
      confidence: 'medium'
    },
    {
      id: 'n-resolved-low',
      kind: 'event',
      names: { en: 'Incident resolved (low severity)', ar: 'تم حل الحادثة (خطورة منخفضة)' },
      confidence: 'medium'
    },
    {
      id: 'n-resolved-high',
      kind: 'event',
      names: { en: 'Incident resolved (high severity)', ar: 'تم حل الحادثة (خطورة عالية)' },
      confidence: 'high'
    }
  ],
  decisions: [
    {
      id: 'd-triage',
      nodeId: 'n-triage',
      criteria: { en: 'Severity classification rules', ar: 'قواعد تصنيف الخطورة' },
      outcomes: [
        {
          id: 'o-high',
          names: { en: 'High severity', ar: 'خطورة عالية' },
          targetNodeId: 'n-investigate'
        },
        {
          id: 'o-low',
          names: { en: 'Low severity', ar: 'خطورة منخفضة' },
          targetNodeId: 'n-resolved-low'
        }
      ],
      factIds: ['f-4'],
      confidence: 'high'
    }
  ],
  edges: [
    {
      id: 'e-1',
      kind: 'sequence',
      sourceNodeId: 'n-start',
      targetNodeId: 'n-log',
      confidence: 'high'
    },
    {
      id: 'e-2',
      kind: 'sequence',
      sourceNodeId: 'n-log',
      targetNodeId: 'n-triage',
      confidence: 'high'
    },
    // Parallel fan-out: n-investigate splits into n-notify and n-wait.
    {
      id: 'e-3',
      kind: 'parallel',
      sourceNodeId: 'n-investigate',
      targetNodeId: 'n-notify',
      confidence: 'medium'
    },
    {
      id: 'e-4',
      kind: 'parallel',
      sourceNodeId: 'n-investigate',
      targetNodeId: 'n-wait',
      confidence: 'medium'
    },
    // Parallel fan-in: n-notify and n-wait converge on n-handoff.
    {
      id: 'e-5',
      kind: 'parallel',
      sourceNodeId: 'n-notify',
      targetNodeId: 'n-handoff',
      confidence: 'medium'
    },
    {
      id: 'e-6',
      kind: 'parallel',
      sourceNodeId: 'n-wait',
      targetNodeId: 'n-handoff',
      confidence: 'low'
    },
    {
      id: 'e-7',
      kind: 'sequence',
      sourceNodeId: 'n-handoff',
      targetNodeId: 'n-exception',
      confidence: 'medium'
    },
    // The required exception-route edge to a rejected-end event.
    {
      id: 'e-8',
      kind: 'exception-route',
      sourceNodeId: 'n-exception',
      targetNodeId: 'n-rejected-end',
      confidence: 'high'
    },
    {
      id: 'e-9',
      kind: 'sequence',
      sourceNodeId: 'n-exception',
      targetNodeId: 'n-resolved-high',
      confidence: 'medium'
    }
  ],
  roles: [
    {
      id: 'r-agent',
      names: { en: 'Support Agent', ar: 'وكيل الدعم' },
      nodeIds: ['n-log', 'n-investigate'],
      factIds: ['f-1'],
      confidence: 'high'
    },
    {
      id: 'r-manager',
      names: { en: 'IT Manager', ar: 'مدير تقنية المعلومات' },
      unit: { en: 'IT Operations', ar: 'عمليات تقنية المعلومات' },
      nodeIds: ['n-triage', 'n-exception'],
      owner: true,
      factIds: ['f-4'],
      confidence: 'high'
    }
  ],
  systems: [
    {
      id: 's-itsm',
      names: { en: 'ITSM Platform', ar: 'منصة إدارة خدمات تقنية المعلومات' },
      nodeIds: ['n-log', 'n-triage'],
      confidence: 'high'
    },
    {
      id: 's-monitoring',
      names: { en: 'Monitoring System', ar: 'نظام المراقبة' },
      nodeIds: ['n-investigate'],
      factIds: ['f-6'],
      confidence: 'medium'
    }
  ],
  informationObjects: [
    {
      // Output-only: produced by n-log, consumed by nothing inside this process.
      id: 'io-ticket',
      names: { en: 'Incident ticket', ar: 'تذكرة الحادثة' },
      inputToNodeIds: [],
      outputOfNodeIds: ['n-log'],
      factIds: ['f-1', 'f-6'],
      confidence: 'high'
    },
    {
      // Input-only: consumed by n-notify, produced by nothing inside this process.
      id: 'io-report',
      names: { en: 'Root cause report', ar: 'تقرير السبب الجذري' },
      inputToNodeIds: ['n-notify'],
      outputOfNodeIds: [],
      confidence: 'medium'
    }
  ],
  controls: [
    {
      id: 'c-sla-policy',
      names: { en: 'SLA Policy', ar: 'سياسة اتفاقية مستوى الخدمة' },
      kind: 'policy',
      nodeIds: ['n-triage'],
      factIds: ['f-3'],
      confidence: 'high'
    },
    {
      id: 'c-escalation-rule',
      names: { en: 'Escalation Rule', ar: 'قاعدة التصعيد' },
      kind: 'business-rule',
      nodeIds: ['n-exception'],
      confidence: 'medium'
    }
  ],
  facts: [
    {
      id: 'f-1',
      statement: {
        en: 'Ticket volume observed at ~42 incidents per day.',
        ar: 'رُصد حجم التذاكر بحوالي 42 حادثة يومياً.'
      },
      evidenceRefs: ['ev-1'],
      confidence: 'high'
    },
    {
      id: 'f-2',
      statement: {
        en: 'Investigation SOP requires a completed root-cause template.',
        ar: 'يتطلب إجراء التحقيق القياسي إكمال نموذج السبب الجذري.'
      },
      evidenceRefs: ['ev-2'],
      confidence: 'medium'
    },
    {
      id: 'f-3',
      statement: {
        en: 'SLA breach threshold is 4 hours from report.',
        ar: 'حد خرق اتفاقية مستوى الخدمة هو 4 ساعات من وقت الإبلاغ.'
      },
      evidenceRefs: ['ev-3a', 'ev-3b'],
      confidence: 'high'
    },
    {
      id: 'f-4',
      statement: {
        en: 'The IT Manager approves all high-severity escalations.',
        ar: 'يوافق مدير تقنية المعلومات على جميع التصعيدات ذات الخطورة العالية.'
      },
      evidenceRefs: ['ev-4'],
      confidence: 'high'
    },
    {
      id: 'f-5',
      statement: {
        en: 'Vendor SLA guarantees a patch within 24 hours.',
        ar: 'تضمن اتفاقية مستوى خدمة المورّد تصحيحاً خلال 24 ساعة.'
      },
      evidenceRefs: ['ev-5'],
      confidence: 'low'
    },
    {
      id: 'f-6',
      statement: {
        en: 'The monitoring system auto-tags incident severity.',
        ar: 'يقوم نظام المراقبة بوسم مستوى خطورة الحادثة تلقائياً.'
      },
      evidenceRefs: ['ev-6'],
      confidence: 'medium'
    }
  ],
  unknowns: [
    {
      targetId: 'n-wait',
      kind: 'ambiguous-mapping',
      field: 'waitDetail',
      message: {
        en: 'Unclear which vendor SLA tier applies to this wait.',
        ar: 'غير واضح أي مستوى من اتفاقية خدمة المورّد ينطبق على هذا الانتظار.'
      },
      factIds: ['f-5']
    },
    {
      targetId: 'io-report',
      kind: 'missing-field',
      field: 'outputOfNodeIds',
      message: {
        en: 'The producing node for the root-cause report is not documented.',
        ar: 'العقدة المنتجة لتقرير السبب الجذري غير موثقة.'
      }
    }
  ]
})

// ---------------------------------------------------------------------------
// VALID_CANONICAL_RETURN_PATH — loop/return-path (milestone amendment)
// ---------------------------------------------------------------------------

/**
 * A rework loop: `n-rework -> n-review` is a return edge that closes a cycle
 * (`n-review -> n-decide -> [outcome] -> n-rework -> n-review -> ...`), yet
 * `n-end` remains reachable from `n-start` via the decision's "approved"
 * outcome regardless of how many times the loop iterates. `contract.ts`
 * itself has no reachability refinement (that lands in L-PROJECT / the new
 * `epc.startEnd.unreachableEnd` EPC rule, Wave 19) — this fixture only needs
 * to be schema-valid AND genuinely possess that loop/reachability shape for
 * those later lanes to exercise.
 */
export const VALID_CANONICAL_RETURN_PATH: CanonicalProcessV1 = deepFreeze({
  version: 1,
  identity: {
    id: 'proc-return-path',
    names: {
      en: 'Change Request Review (with rework loop)',
      ar: 'مراجعة طلب التغيير (مع حلقة إعادة العمل)'
    },
    confidence: 'high'
  },
  nodes: [
    {
      id: 'n-start',
      kind: 'event',
      names: { en: 'Request submitted', ar: 'تم تقديم الطلب' },
      confidence: 'high'
    },
    {
      id: 'n-review',
      kind: 'activity',
      names: { en: 'Review request', ar: 'مراجعة الطلب' },
      confidence: 'high'
    },
    {
      id: 'n-decide',
      kind: 'decision',
      names: { en: 'Review outcome', ar: 'نتيجة المراجعة' },
      confidence: 'high'
    },
    {
      id: 'n-rework',
      kind: 'activity',
      names: { en: 'Rework request', ar: 'إعادة العمل على الطلب' },
      confidence: 'medium'
    },
    {
      id: 'n-end',
      kind: 'event',
      names: { en: 'Request approved', ar: 'تمت الموافقة على الطلب' },
      confidence: 'high'
    }
  ],
  decisions: [
    {
      id: 'd-review',
      nodeId: 'n-decide',
      criteria: {
        en: 'Completeness and compliance checklist',
        ar: 'قائمة اكتمال المراجعة والامتثال'
      },
      outcomes: [
        { id: 'o-approved', names: { en: 'Approved', ar: 'موافق عليه' }, targetNodeId: 'n-end' },
        {
          id: 'o-rework',
          names: { en: 'Needs rework', ar: 'يحتاج إعادة عمل' },
          targetNodeId: 'n-rework'
        }
      ],
      confidence: 'high'
    }
  ],
  edges: [
    {
      id: 'e-1',
      kind: 'sequence',
      sourceNodeId: 'n-start',
      targetNodeId: 'n-review',
      confidence: 'high'
    },
    {
      id: 'e-2',
      kind: 'sequence',
      sourceNodeId: 'n-review',
      targetNodeId: 'n-decide',
      confidence: 'high'
    },
    // The return edge: closes the review -> decide -> rework -> review cycle.
    {
      id: 'e-3',
      kind: 'sequence',
      sourceNodeId: 'n-rework',
      targetNodeId: 'n-review',
      confidence: 'medium'
    }
  ],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: []
})

// ---------------------------------------------------------------------------
// VALID_CANONICAL_MISSING_ROLE — missing ownership surfaced as an unknown
// ---------------------------------------------------------------------------

/**
 * No role is declared for the approval activity — ownership is unknown, not
 * a hard error. The gap is surfaced as a `CanonicalUnknown` (kind
 * `'missing-field'`, field `'role'`) targeting the activity node, and the
 * process still parses `ok:true` (milestone-amendment bullet, plan line 27).
 */
export const VALID_CANONICAL_MISSING_ROLE: CanonicalProcessV1 = deepFreeze({
  version: 1,
  identity: {
    id: 'proc-missing-role',
    names: { en: 'Ad Hoc Approval (role unknown)', ar: 'موافقة غير رسمية (الدور غير معروف)' },
    confidence: 'medium'
  },
  nodes: [
    {
      id: 'n-start',
      kind: 'event',
      names: { en: 'Request received', ar: 'تم استلام الطلب' },
      confidence: 'high'
    },
    {
      id: 'n-approve',
      kind: 'activity',
      names: { en: 'Approve request', ar: 'الموافقة على الطلب' },
      confidence: 'medium'
    },
    {
      id: 'n-end',
      kind: 'event',
      names: { en: 'Request closed', ar: 'تم إغلاق الطلب' },
      confidence: 'high'
    }
  ],
  decisions: [],
  edges: [
    {
      id: 'e-1',
      kind: 'sequence',
      sourceNodeId: 'n-start',
      targetNodeId: 'n-approve',
      confidence: 'high'
    },
    {
      id: 'e-2',
      kind: 'sequence',
      sourceNodeId: 'n-approve',
      targetNodeId: 'n-end',
      confidence: 'high'
    }
  ],
  // Deliberately empty: nobody is documented as owning/performing n-approve.
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: [
    {
      targetId: 'n-approve',
      kind: 'missing-field',
      field: 'role',
      message: {
        en: 'No responsible role identified for this approval activity.',
        ar: 'لم يتم تحديد دور مسؤول عن نشاط الموافقة هذا.'
      }
    }
  ]
})

// ---------------------------------------------------------------------------
// INVALID_CANONICAL_* — each broken in EXACTLY one intended way
// ---------------------------------------------------------------------------
//
// Each fixture below is the smallest structure that reproduces its single
// intended cross-reference/shape violation; `fixtures.test.ts` pins the
// expected `code`/`path` down per fixture so a regression that trips a
// DIFFERENT rule first is caught, not just "it failed".

/** (1) Unknown/extra top-level key -> zod `unrecognized_keys`. */
export const INVALID_CANONICAL_UNKNOWN_KEY: unknown = deepFreeze({
  version: 1,
  identity: {
    id: 'proc-invalid-unknown-key',
    names: { en: 'Unknown key fixture' },
    confidence: 'high'
  },
  nodes: [{ id: 'n-start', kind: 'event', names: { en: 'Start' }, confidence: 'high' }],
  decisions: [],
  edges: [],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: [],
  // The one intended defect: an undeclared top-level key.
  unexpectedTopLevelField: 'sneaky'
})

/** (2) Missing `confidence` on a node -> zod `invalid_value` (enum). */
export const INVALID_CANONICAL_MISSING_CONFIDENCE: unknown = deepFreeze({
  version: 1,
  identity: {
    id: 'proc-invalid-missing-confidence',
    names: { en: 'Missing confidence fixture' },
    confidence: 'high'
  },
  // The one intended defect: this node has no `confidence` field at all.
  nodes: [{ id: 'n-task', kind: 'activity', names: { en: 'Task' } }],
  decisions: [],
  edges: [],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: []
})

/** (3) Dangling `edge.targetNodeId` -> `dangling-node-reference`. */
export const INVALID_CANONICAL_DANGLING_EDGE_TARGET: unknown = deepFreeze({
  version: 1,
  identity: {
    id: 'proc-invalid-dangling-edge-target',
    names: { en: 'Dangling edge target fixture' },
    confidence: 'high'
  },
  nodes: [{ id: 'n-start', kind: 'event', names: { en: 'Start' }, confidence: 'high' }],
  decisions: [],
  edges: [
    {
      id: 'e-1',
      kind: 'sequence',
      sourceNodeId: 'n-start',
      // The one intended defect: no node with this id is declared.
      targetNodeId: 'n-missing',
      confidence: 'high'
    }
  ],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: []
})

/** (4) Duplicate id across arrays -> `duplicate-id`. */
export const INVALID_CANONICAL_DUPLICATE_ID: unknown = deepFreeze({
  version: 1,
  identity: {
    id: 'proc-invalid-duplicate-id',
    names: { en: 'Duplicate id fixture' },
    confidence: 'high'
  },
  nodes: [{ id: 'n-start', kind: 'event', names: { en: 'Start' }, confidence: 'high' }],
  decisions: [],
  edges: [],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  // The one intended defect: this fact reuses node id "n-start".
  facts: [
    {
      id: 'n-start',
      statement: { en: 'Reuses a node id.' },
      evidenceRefs: ['ev-1'],
      confidence: 'medium'
    }
  ],
  unknowns: []
})

/** (5) Empty `names` (neither en nor ar) -> `canonical-text-empty`. */
export const INVALID_CANONICAL_EMPTY_NAMES: unknown = deepFreeze({
  version: 1,
  identity: {
    id: 'proc-invalid-empty-names',
    names: { en: 'Empty names fixture' },
    confidence: 'high'
  },
  nodes: [
    // The one intended defect: `names` carries neither `en` nor `ar`.
    { id: 'n-start', kind: 'event', names: {}, confidence: 'high' }
  ],
  decisions: [],
  edges: [],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: []
})

/** (6) `conditional` edge without `condition` -> `edge-condition-required`. */
export const INVALID_CANONICAL_CONDITIONAL_WITHOUT_CONDITION: unknown = deepFreeze({
  version: 1,
  identity: {
    id: 'proc-invalid-conditional-without-condition',
    names: { en: 'Conditional without condition fixture' },
    confidence: 'high'
  },
  nodes: [
    { id: 'n-start', kind: 'event', names: { en: 'Start' }, confidence: 'high' },
    { id: 'n-task', kind: 'activity', names: { en: 'Task' }, confidence: 'high' }
  ],
  decisions: [],
  edges: [
    {
      id: 'e-1',
      // The one intended defect: kind is "conditional" but there is no `condition`.
      kind: 'conditional',
      sourceNodeId: 'n-start',
      targetNodeId: 'n-task',
      confidence: 'high'
    }
  ],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: []
})

/** (7) `sequence` edge out of a decision node -> `decision-node-sequence-edge`. */
export const INVALID_CANONICAL_SEQUENCE_FROM_DECISION: unknown = deepFreeze({
  version: 1,
  identity: {
    id: 'proc-invalid-sequence-from-decision',
    names: { en: 'Sequence from decision fixture' },
    confidence: 'high'
  },
  nodes: [
    { id: 'n-decide', kind: 'decision', names: { en: 'Decide' }, confidence: 'high' },
    { id: 'n-a', kind: 'event', names: { en: 'A' }, confidence: 'high' },
    { id: 'n-b', kind: 'event', names: { en: 'B' }, confidence: 'high' }
  ],
  decisions: [
    {
      id: 'd-1',
      nodeId: 'n-decide',
      outcomes: [
        { id: 'o-a', names: { en: 'A' }, targetNodeId: 'n-a' },
        { id: 'o-b', names: { en: 'B' }, targetNodeId: 'n-b' }
      ],
      confidence: 'high'
    }
  ],
  edges: [
    // The one intended defect: a plain `sequence` edge sourced from the
    // decision node itself, instead of going only through decisions[].outcomes.
    {
      id: 'e-1',
      kind: 'sequence',
      sourceNodeId: 'n-decide',
      targetNodeId: 'n-a',
      confidence: 'high'
    }
  ],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: []
})

/** (8) Decision with only 1 outcome -> zod `too_small` (outcomes.min(2)). */
export const INVALID_CANONICAL_DECISION_SINGLE_OUTCOME: unknown = deepFreeze({
  version: 1,
  identity: {
    id: 'proc-invalid-decision-single-outcome',
    names: { en: 'Decision single outcome fixture' },
    confidence: 'high'
  },
  nodes: [
    { id: 'n-decide', kind: 'decision', names: { en: 'Decide' }, confidence: 'high' },
    { id: 'n-a', kind: 'event', names: { en: 'A' }, confidence: 'high' }
  ],
  decisions: [
    {
      id: 'd-1',
      nodeId: 'n-decide',
      // The one intended defect: only 1 outcome; the schema requires >=2.
      outcomes: [{ id: 'o-a', names: { en: 'A' }, targetNodeId: 'n-a' }],
      confidence: 'high'
    }
  ],
  edges: [],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: []
})

/** (9) Dangling `factIds` entry -> `dangling-fact-reference`. */
export const INVALID_CANONICAL_DANGLING_FACT_ID: unknown = deepFreeze({
  version: 1,
  identity: {
    id: 'proc-invalid-dangling-fact-id',
    names: { en: 'Dangling fact id fixture' },
    confidence: 'high'
  },
  nodes: [
    {
      id: 'n-start',
      kind: 'event',
      names: { en: 'Start' },
      // The one intended defect: no fact with this id is declared.
      factIds: ['f-missing'],
      confidence: 'high'
    }
  ],
  decisions: [],
  edges: [],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: []
})

/** (10) Dangling `unknowns[*].targetId` -> `dangling-unknown-target`. */
export const INVALID_CANONICAL_DANGLING_UNKNOWN_TARGET: unknown = deepFreeze({
  version: 1,
  identity: {
    id: 'proc-invalid-dangling-unknown-target',
    names: { en: 'Dangling unknown target fixture' },
    confidence: 'high'
  },
  nodes: [{ id: 'n-start', kind: 'event', names: { en: 'Start' }, confidence: 'high' }],
  decisions: [],
  edges: [],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: [
    {
      // The one intended defect: no declared id anywhere matches this targetId.
      targetId: 'does-not-exist',
      kind: 'other',
      message: { en: 'Refers to nothing.' }
    }
  ]
})
