import { t, type Key } from '../i18n'
import type { ValidationIssue } from './contracts'

type IssueLocalizationSpec = Readonly<{
  message: Key
  repair: Key
}>

const FIXED_ISSUE_LOCALIZATION = Object.freeze({
  'xml.empty': {
    message: 'validation.issue.xml.empty',
    repair: 'validation.repair.xml.provideDocument'
  },
  'xml.size-limit': {
    message: 'validation.issue.xml.size-limit',
    repair: 'validation.repair.xml.reduceDocument'
  },
  'xml.illegal-character': {
    message: 'validation.issue.xml.illegal-character',
    repair: 'validation.repair.xml.removeInvalidContent'
  },
  'xml.unsupported-encoding': {
    message: 'validation.issue.xml.unsupported-encoding',
    repair: 'validation.repair.xml.convertUtf8'
  },
  'xml.doctype': {
    message: 'validation.issue.xml.doctype',
    repair: 'validation.repair.xml.removeUnsafeConstruct'
  },
  'xml.entity-declaration': {
    message: 'validation.issue.xml.entity-declaration',
    repair: 'validation.repair.xml.removeUnsafeConstruct'
  },
  'xml.external-include': {
    message: 'validation.issue.xml.external-include',
    repair: 'validation.repair.xml.removeUnsafeConstruct'
  },
  'xml.processing-instruction': {
    message: 'validation.issue.xml.processing-instruction',
    repair: 'validation.repair.xml.removeUnsafeConstruct'
  },
  'xml.declaration-position': {
    message: 'validation.issue.xml.declaration-position',
    repair: 'validation.repair.xml.moveDeclaration'
  },
  'xml.text-limit': {
    message: 'validation.issue.xml.text-limit',
    repair: 'validation.repair.xml.reduceDocument'
  },
  'xml.attribute-count-limit': {
    message: 'validation.issue.xml.attribute-count-limit',
    repair: 'validation.repair.xml.reduceDocument'
  },
  'xml.attribute-value-limit': {
    message: 'validation.issue.xml.attribute-value-limit',
    repair: 'validation.repair.xml.reduceDocument'
  },
  'xml.element-count-limit': {
    message: 'validation.issue.xml.element-count-limit',
    repair: 'validation.repair.xml.reduceDocument'
  },
  'xml.depth-limit': {
    message: 'validation.issue.xml.depth-limit',
    repair: 'validation.repair.xml.reduceDocument'
  },
  'moddle.unresolved-reference': {
    message: 'validation.issue.moddle.unresolved-reference',
    repair: 'validation.repair.references'
  },
  'moddle.duplicate-id': {
    message: 'validation.issue.moddle.duplicate-id',
    repair: 'validation.repair.uniqueIds'
  },
  'moddle.unparsable-content': {
    message: 'validation.issue.moddle.unparsable-content',
    repair: 'validation.repair.xml.repairSyntax'
  },
  'moddle.warning': {
    message: 'validation.issue.moddle.warning',
    repair: 'validation.repair.reviewModel'
  },
  'moddle.parse-error': {
    message: 'validation.issue.moddle.parse-error',
    repair: 'validation.repair.xml.repairSyntax'
  },
  'moddle.root-missing': {
    message: 'validation.issue.moddle.root-missing',
    repair: 'validation.repair.restoreRoot'
  },
  'structure.definitions-root': {
    message: 'validation.issue.structure.definitions-root',
    repair: 'validation.repair.wrapDefinitions'
  },
  'structure.definitions-id': {
    message: 'validation.issue.structure.definitions-id',
    repair: 'validation.repair.addId'
  },
  'structure.target-namespace': {
    message: 'validation.issue.structure.target-namespace',
    repair: 'validation.repair.targetNamespace'
  },
  'structure.target-namespace-uri': {
    message: 'validation.issue.structure.target-namespace-uri',
    repair: 'validation.repair.targetNamespace'
  },
  'structure.process-missing': {
    message: 'validation.issue.structure.process-missing',
    repair: 'validation.repair.addProcess'
  },
  'structure.duplicate-id': {
    message: 'validation.issue.structure.duplicate-id',
    repair: 'validation.repair.uniqueIds'
  },
  'structure.invalid-id': {
    message: 'validation.issue.structure.invalid-id',
    repair: 'validation.repair.validId'
  },
  'structure.sequence-ref-missing': {
    message: 'validation.issue.structure.sequence-ref-missing',
    repair: 'validation.repair.references'
  },
  'structure.sequence-ref-container': {
    message: 'validation.issue.structure.sequence-ref-container',
    repair: 'validation.repair.references'
  },
  'structure.incoming-mismatch': {
    message: 'validation.issue.structure.incoming-mismatch',
    repair: 'validation.repair.references'
  },
  'structure.outgoing-mismatch': {
    message: 'validation.issue.structure.outgoing-mismatch',
    repair: 'validation.repair.references'
  },
  'structure.lane-node-ref': {
    message: 'validation.issue.structure.lane-node-ref',
    repair: 'validation.repair.references'
  },
  'structure.participant-process-ref': {
    message: 'validation.issue.structure.participant-process-ref',
    repair: 'validation.repair.references'
  },
  'structure.message-flow-ref': {
    message: 'validation.issue.structure.message-flow-ref',
    repair: 'validation.repair.references'
  },
  'structure.process-id': {
    message: 'validation.issue.structure.process-id',
    repair: 'validation.repair.addId'
  },
  'semantic.start-incoming': {
    message: 'validation.issue.semantic.start-incoming',
    repair: 'validation.repair.flowDirection'
  },
  'semantic.end-outgoing': {
    message: 'validation.issue.semantic.end-outgoing',
    repair: 'validation.repair.flowDirection'
  },
  'semantic.default-source': {
    message: 'validation.issue.semantic.default-source',
    repair: 'validation.repair.defaultFlow'
  },
  'semantic.default-not-outgoing': {
    message: 'validation.issue.semantic.default-not-outgoing',
    repair: 'validation.repair.defaultFlow'
  },
  'semantic.default-has-condition': {
    message: 'validation.issue.semantic.default-has-condition',
    repair: 'validation.repair.defaultFlow'
  },
  'semantic.branch-condition-missing': {
    message: 'validation.issue.semantic.branch-condition-missing',
    repair: 'validation.repair.conditions'
  },
  'semantic.condition-source': {
    message: 'validation.issue.semantic.condition-source',
    repair: 'validation.repair.conditions'
  },
  'semantic.boundary-attachment': {
    message: 'validation.issue.semantic.boundary-attachment',
    repair: 'validation.repair.boundaryAttachment'
  },
  'semantic.disconnected-node': {
    message: 'validation.issue.semantic.disconnected-node',
    repair: 'validation.repair.reconnectFlow'
  },
  'di.plane-missing': {
    message: 'validation.issue.di.plane-missing',
    repair: 'validation.repair.regenerateDi'
  },
  'di.plane-target': {
    message: 'validation.issue.di.plane-target',
    repair: 'validation.repair.regenerateDi'
  },
  'di.element-ref': {
    message: 'validation.issue.di.element-ref',
    repair: 'validation.repair.regenerateDi'
  },
  'di.element-plane-mismatch': {
    message: 'validation.issue.di.element-plane-mismatch',
    repair: 'validation.repair.regenerateDi'
  },
  'di.shape-bounds': {
    message: 'validation.issue.di.shape-bounds',
    repair: 'validation.repair.regenerateDi'
  },
  'di.edge-waypoints': {
    message: 'validation.issue.di.edge-waypoints',
    repair: 'validation.repair.regenerateDi'
  },
  'di.process-missing': {
    message: 'validation.issue.di.process-missing',
    repair: 'validation.repair.regenerateDi'
  },
  'orbitpm.active-language': {
    message: 'validation.issue.orbitpm.active-language',
    repair: 'validation.repair.localization'
  },
  'orbitpm.active-projection-mismatch': {
    message: 'validation.issue.orbitpm.active-projection-mismatch',
    repair: 'validation.repair.localization'
  },
  'orbitpm.bilingual-missing-en': {
    message: 'validation.issue.orbitpm.bilingual-missing-en',
    repair: 'validation.repair.localization'
  },
  'orbitpm.bilingual-missing-ar': {
    message: 'validation.issue.orbitpm.bilingual-missing-ar',
    repair: 'validation.repair.localization'
  },
  'orbitpm.bilingual-wrong-script-en': {
    message: 'validation.issue.orbitpm.bilingual-wrong-script-en',
    repair: 'validation.repair.localization'
  },
  'orbitpm.bilingual-wrong-script-ar': {
    message: 'validation.issue.orbitpm.bilingual-wrong-script-ar',
    repair: 'validation.repair.localization'
  },
  'orbitpm.bilingual-duplicate-counterpart': {
    message: 'validation.issue.orbitpm.bilingual-duplicate-counterpart',
    repair: 'validation.repair.localization'
  },
  'orbitpm.bilingual-mixed-en': {
    message: 'validation.issue.orbitpm.bilingual-mixed-en',
    repair: 'validation.repair.localization'
  },
  'orbitpm.bilingual-mixed-ar': {
    message: 'validation.issue.orbitpm.bilingual-mixed-ar',
    repair: 'validation.repair.localization'
  },
  'orbitpm.bilingual-provider-failed': {
    message: 'validation.issue.orbitpm.bilingual-provider-failed',
    repair: 'validation.repair.localization'
  },
  'orbitpm.call-unlinked': {
    message: 'validation.issue.orbitpm.call-unlinked',
    repair: 'validation.repair.linkProcess'
  },
  'orbitpm.call-unresolved': {
    message: 'validation.issue.orbitpm.call-unresolved',
    repair: 'validation.repair.linkProcess'
  },
  'preservation.snapshot-failed': {
    message: 'validation.issue.preservation.snapshot-failed',
    repair: 'validation.repair.preserveExtensions'
  },
  'preservation.extension-element-changed': {
    message: 'validation.issue.preservation.extension-element-changed',
    repair: 'validation.repair.preserveExtensions'
  },
  'preservation.extension-attribute-changed': {
    message: 'validation.issue.preservation.extension-attribute-changed',
    repair: 'validation.repair.preserveExtensions'
  },
  'xsd.adapter-failure': {
    message: 'validation.issue.adapterFailure',
    repair: 'validation.repair.restoreValidator'
  },
  'bpmnlint.adapter-failure': {
    message: 'validation.issue.adapterFailure',
    repair: 'validation.repair.restoreValidator'
  }
} satisfies Record<string, IssueLocalizationSpec>)

export const KNOWN_BPMNLINT_RULE_IDS = Object.freeze([
  'ad-hoc-sub-process',
  'conditional-flows',
  'end-event-required',
  'event-based-gateway',
  'event-sub-process-typed-start-event',
  'fake-join',
  'global',
  'label-required',
  'link-event',
  'no-bpmndi',
  'no-complex-gateway',
  'no-disconnected',
  'no-duplicate-sequence-flows',
  'no-gateway-join-fork',
  'no-implicit-end',
  'no-implicit-split',
  'no-implicit-start',
  'no-inclusive-gateway',
  'no-overlapping-elements',
  'single-blank-start-event',
  'single-event-definition',
  'start-event-required',
  'sub-process-blank-start-event',
  'superfluous-gateway',
  'superfluous-termination'
] as const)

export const KNOWN_VALIDATION_ISSUE_CODES = Object.freeze(
  Object.keys(FIXED_ISSUE_LOCALIZATION) as Array<keyof typeof FIXED_ISSUE_LOCALIZATION>
)

const KNOWN_BPMNLINT_RULES = new Set<string>(KNOWN_BPMNLINT_RULE_IDS)

function fixedSpec(code: string): IssueLocalizationSpec | undefined {
  if (!Object.prototype.hasOwnProperty.call(FIXED_ISSUE_LOCALIZATION, code)) return undefined
  return FIXED_ISSUE_LOCALIZATION[code as keyof typeof FIXED_ISSUE_LOCALIZATION]
}

export interface LocalizedValidationIssue {
  message: string
  suggestedRepair: string
  classification: 'known' | 'external' | 'fallback'
}

/**
 * Localize durable validation codes without interpolating untrusted diagnostic
 * prose. Callers should render `issue.message`, `issue.code`, and `issue.ruleId`
 * separately as explicitly labeled technical evidence.
 */
export function localizeValidationIssue(issue: ValidationIssue): LocalizedValidationIssue {
  const fixed = fixedSpec(issue.code)
  if (fixed) {
    return {
      message: t(fixed.message),
      suggestedRepair: t(fixed.repair),
      classification: 'known'
    }
  }

  if (issue.source === 'xsd' || issue.code.startsWith('xsd.')) {
    return {
      message: t('validation.issue.xsd'),
      suggestedRepair: t('validation.repair.xsd'),
      classification: 'external'
    }
  }

  const ruleId = issue.ruleId ?? issue.code.replace(/^bpmnlint\./, '')
  if (
    issue.source === 'bpmnlint' ||
    issue.code === 'bpmnlint.issue' ||
    KNOWN_BPMNLINT_RULES.has(ruleId)
  ) {
    return {
      message: t('validation.issue.bpmnlint'),
      suggestedRepair: t('validation.repair.bpmnlint'),
      classification: KNOWN_BPMNLINT_RULES.has(ruleId) ? 'known' : 'external'
    }
  }

  return {
    message: t('validation.issue.fallback'),
    suggestedRepair: t('validation.repair.fallback'),
    classification: 'fallback'
  }
}
