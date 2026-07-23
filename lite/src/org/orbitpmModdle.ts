// The `orbitpm` moddle extension descriptor. Registered with bpmn-js via
// `moddleExtensions: { orbitpm: orbitpmModdleDescriptor }` (Phase B wires this
// in EditorTabLite). It uses the same `extends` mechanism as camunda-moddle /
// the bpmn.io `bioc` colour extension (see
// node_modules/bpmn-moddle/resources/bpmn-io/json/bioc.json): a single type
// that `extends: ['bpmn:BaseElement']` so EVERY flow node, the process and the
// start event alike gain the `orbitpm:*` attributes, letting
// `modeling.updateProperties(element, { 'orbitpm:owner': '…' })` write them
// straight onto the business object as real, round-trippable XML attributes.

export const ORBITPM_URI = 'http://orbitpm.ae/schema/bpmn/1.0'
export const ORBITPM_PREFIX = 'orbitpm'

/**
 * Every `orbitpm:*` attribute name in the contract, WITHOUT the prefix. The
 * union across flow nodes (owner/ownerType/ownerRole/channel/channelDetail/
 * kind/ccTo), start events (trigger/triggerService/triggerDetail) and the
 * process (owner/ownerType). One flat list because a single `OrgExtension`
 * type carries them all.
 */
export const ORG_ATTR_NAMES = [
  'owner',
  'ownerType',
  'ownerRole',
  'channel',
  'channelDetail',
  'kind',
  'ccTo',
  'trigger',
  'triggerService',
  'triggerDetail'
] as const

export type OrgAttrName = (typeof ORG_ATTR_NAMES)[number]

interface ModdleProperty {
  name: string
  isAttr: boolean
  type: string
}

interface ModdleTypeDescriptor {
  name: string
  extends: string[]
  properties: ModdleProperty[]
}

export interface ModdleDescriptor {
  name: string
  uri: string
  prefix: string
  xml: { tagAlias: string }
  types: ModdleTypeDescriptor[]
}

export const orbitpmModdleDescriptor: ModdleDescriptor = {
  name: 'orbitpm',
  uri: ORBITPM_URI,
  prefix: ORBITPM_PREFIX,
  // `tagAlias: 'lowerCase'` matches how camunda-moddle emits attributes; keeps
  // the serialized form aligned with the lowerCamel property names above.
  xml: { tagAlias: 'lowerCase' },
  types: [
    {
      name: 'OrgExtension',
      extends: ['bpmn:BaseElement'],
      properties: ORG_ATTR_NAMES.map((name) => ({
        name,
        isAttr: true,
        type: 'String'
      }))
    }
  ]
}
