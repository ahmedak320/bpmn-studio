import adHocSubProcess from 'bpmnlint/rules/ad-hoc-sub-process'
import conditionalFlows from 'bpmnlint/rules/conditional-flows'
import endEventRequired from 'bpmnlint/rules/end-event-required'
import eventBasedGateway from 'bpmnlint/rules/event-based-gateway'
import eventSubProcessTypedStartEvent from 'bpmnlint/rules/event-sub-process-typed-start-event'
import fakeJoin from 'bpmnlint/rules/fake-join'
import globalRule from 'bpmnlint/rules/global'
import labelRequired from 'bpmnlint/rules/label-required'
import linkEvent from 'bpmnlint/rules/link-event'
import noBpmndi from 'bpmnlint/rules/no-bpmndi'
import noComplexGateway from 'bpmnlint/rules/no-complex-gateway'
import noDisconnected from 'bpmnlint/rules/no-disconnected'
import noDuplicateSequenceFlows from 'bpmnlint/rules/no-duplicate-sequence-flows'
import noGatewayJoinFork from 'bpmnlint/rules/no-gateway-join-fork'
import noImplicitEnd from 'bpmnlint/rules/no-implicit-end'
import noImplicitSplit from 'bpmnlint/rules/no-implicit-split'
import noImplicitStart from 'bpmnlint/rules/no-implicit-start'
import noInclusiveGateway from 'bpmnlint/rules/no-inclusive-gateway'
import noOverlappingElements from 'bpmnlint/rules/no-overlapping-elements'
import singleBlankStartEvent from 'bpmnlint/rules/single-blank-start-event'
import singleEventDefinition from 'bpmnlint/rules/single-event-definition'
import startEventRequired from 'bpmnlint/rules/start-event-required'
import subProcessBlankStartEvent from 'bpmnlint/rules/sub-process-blank-start-event'
import superfluousGateway from 'bpmnlint/rules/superfluous-gateway'
import superfluousTermination from 'bpmnlint/rules/superfluous-termination'

type RuleFactory = (options?: unknown) => unknown

const ruleFactories: Readonly<Record<string, RuleFactory>> = Object.freeze({
  'ad-hoc-sub-process': adHocSubProcess,
  'conditional-flows': conditionalFlows,
  'end-event-required': endEventRequired,
  'event-based-gateway': eventBasedGateway,
  'event-sub-process-typed-start-event': eventSubProcessTypedStartEvent,
  'fake-join': fakeJoin,
  global: globalRule,
  'label-required': labelRequired,
  'link-event': linkEvent,
  'no-bpmndi': noBpmndi,
  'no-complex-gateway': noComplexGateway,
  'no-disconnected': noDisconnected,
  'no-duplicate-sequence-flows': noDuplicateSequenceFlows,
  'no-gateway-join-fork': noGatewayJoinFork,
  'no-implicit-end': noImplicitEnd,
  'no-implicit-split': noImplicitSplit,
  'no-implicit-start': noImplicitStart,
  'no-inclusive-gateway': noInclusiveGateway,
  'no-overlapping-elements': noOverlappingElements,
  'single-blank-start-event': singleBlankStartEvent,
  'single-event-definition': singleEventDefinition,
  'start-event-required': startEventRequired,
  'sub-process-blank-start-event': subProcessBlankStartEvent,
  'superfluous-gateway': superfluousGateway,
  'superfluous-termination': superfluousTermination
})

export const recommendedBpmnlintRules = Object.freeze({
  'ad-hoc-sub-process': 'error',
  'conditional-flows': 'error',
  'end-event-required': 'error',
  'event-based-gateway': 'error',
  'event-sub-process-typed-start-event': 'error',
  'fake-join': 'warn',
  global: 'warn',
  'label-required': 'error',
  'link-event': 'error',
  'no-bpmndi': 'error',
  'no-complex-gateway': 'error',
  'no-disconnected': 'error',
  'no-duplicate-sequence-flows': 'error',
  'no-gateway-join-fork': 'error',
  'no-implicit-split': 'error',
  'no-implicit-end': 'error',
  'no-implicit-start': 'error',
  'no-inclusive-gateway': 'warn',
  'no-overlapping-elements': 'warn',
  'single-blank-start-event': 'error',
  'single-event-definition': 'error',
  'start-event-required': 'error',
  'sub-process-blank-start-event': 'error',
  'superfluous-gateway': 'warn',
  'superfluous-termination': 'warn'
} as const)

/**
 * Static resolver format consumed by both bpmnlint's programmatic Linter and
 * bpmn-js-bpmnlint. Bundling every rule explicitly keeps browser validation
 * deterministic and prevents runtime require()/network resolution.
 */
export const recommendedBpmnlintBundle = Object.freeze({
  config: Object.freeze({ rules: recommendedBpmnlintRules }),
  resolver: Object.freeze({
    resolveRule(pkg: string, ruleName: string): RuleFactory {
      if (pkg !== 'bpmnlint') {
        throw new Error(`Unsupported bpmnlint package "${pkg}".`)
      }
      const rule = ruleFactories[ruleName]
      if (!rule) throw new Error(`BPMN lint rule "${ruleName}" is not bundled.`)
      return rule
    },
    resolveConfig(pkg: string, configName: string): never {
      throw new Error(`BPMN lint config "${pkg}:${configName}" is not bundled.`)
    }
  }),
  moddleExtensions: Object.freeze({})
})

export default recommendedBpmnlintBundle
