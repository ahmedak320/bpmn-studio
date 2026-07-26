import { describe, it, expect } from 'vitest'
import {
  readOrgAttrsFromTag,
  getOrgProps,
  setOrgProps,
  getProcessOrgProps,
  setProcessOrgProps,
  getProcessDocumentation,
  setProcessDocumentation,
  getLinkedNote,
  setStepNote,
  getProcessElement,
  mergeActiveLanguageOrgProps,
  PAIRED_ORG_PROJECTION_FIELDS,
  splitList,
  joinList,
  parseTriggers,
  serializeTriggers,
  TRIGGER_TYPES,
  type OrgProps,
  type OrgModeler,
  type OrgElementLike
} from '../orgModel'
import { ORG_ATTR_NAMES } from '../orbitpmModdle'

// --- recorder fakes ---------------------------------------------------------

interface Recorded {
  updateProperties: Array<{ element: unknown; properties: Record<string, unknown> }>
  createShape: Array<{ attrs: unknown; bounds: unknown; target: unknown }>
  connect: Array<{ source: unknown; target: unknown; attrs: unknown }>
  removeElements: unknown[][]
  created: Array<{ type: string; attrs?: Record<string, unknown> }>
}

function makeModeler(options: {
  root?: OrgElementLike
  elements?: OrgElementLike[]
  nextShape?: OrgElementLike
}): { modeler: OrgModeler; rec: Recorded } {
  const rec: Recorded = {
    updateProperties: [],
    createShape: [],
    connect: [],
    removeElements: [],
    created: []
  }
  const modeling = {
    updateProperties(element: unknown, properties: Record<string, unknown>): void {
      rec.updateProperties.push({ element, properties })
    },
    createShape(attrs: unknown, bounds: unknown, target: unknown): OrgElementLike {
      rec.createShape.push({ attrs, bounds, target })
      return options.nextShape ?? { id: 'Annotation_new', type: 'bpmn:TextAnnotation' }
    },
    connect(source: unknown, target: unknown, attrs: unknown): unknown {
      rec.connect.push({ source, target, attrs })
      return { id: 'Association_new', type: 'bpmn:Association' }
    },
    removeElements(elements: unknown[]): void {
      rec.removeElements.push(elements)
    }
  }
  const bpmnFactory = {
    create(type: string, attrs?: Record<string, unknown>): unknown {
      rec.created.push({ type, attrs })
      return { $type: type, ...(attrs ?? {}) }
    }
  }
  const canvas = { getRootElement: () => options.root }
  const elementRegistry = { getAll: () => options.elements ?? [] }
  const modeler = {
    get(service: string): unknown {
      switch (service) {
        case 'modeling':
          return modeling
        case 'bpmnFactory':
          return bpmnFactory
        case 'canvas':
          return canvas
        case 'elementRegistry':
          return elementRegistry
        default:
          throw new Error('unexpected service ' + service)
      }
    }
  }
  return { modeler: modeler as unknown as OrgModeler, rec }
}

const PAIRED_CONTRACT_PROPS: OrgProps = {
  owner: 'Operations',
  ownerEn: 'Operations',
  ownerAr: 'العمليات',
  department: 'Permits',
  departmentEn: 'Permits',
  departmentAr: 'التصاريح',
  ownerRole: 'Reviewer',
  ownerRoleEn: 'Reviewer',
  ownerRoleAr: 'مراجع',
  channelDetail: 'Permits inbox',
  channelDetailEn: 'Permits inbox',
  channelDetailAr: 'صندوق بريد التصاريح',
  ccTo: 'Audit office',
  ccToEn: 'Audit office',
  ccToAr: 'مكتب التدقيق',
  triggerService: 'Case service',
  triggerServiceEn: 'Case service',
  triggerServiceAr: 'خدمة الحالات',
  triggerDetail: 'New application',
  triggerDetailEn: 'New application',
  triggerDetailAr: 'طلب جديد',
  triggers: 'dmthub — Case service — New application',
  triggersEn: 'dmthub — Case service — New application',
  triggersAr: 'dmthub — خدمة الحالات — طلب جديد',
  inputs: 'Application',
  inputsEn: 'Application',
  inputsAr: 'الطلب',
  outputs: 'Decision',
  outputsEn: 'Decision',
  outputsAr: 'القرار',
  system: 'Case Hub',
  systemEn: 'Case Hub',
  systemAr: 'منصة الحالات',
  respList: 'Sara — Reviewer',
  respListEn: 'Sara — Reviewer',
  respListAr: 'سارة — مراجع',
  ccList: 'Legal — review',
  ccListEn: 'Legal — review',
  ccListAr: 'الشؤون القانونية — مراجعة',
  decisionBasis: 'Policy 7',
  decisionBasisEn: 'Policy 7',
  decisionBasisAr: 'السياسة 7',
  notes: 'Escalate exceptions',
  notesEn: 'Escalate exceptions',
  notesAr: 'تصعيد الاستثناءات'
}

// --- readOrgAttrsFromTag ----------------------------------------------------

describe('readOrgAttrsFromTag', () => {
  it('reads double-quoted attributes', () => {
    const tag = '<bpmn:task id="T1" orbitpm:owner="Ahmed" orbitpm:ownerType="individual">'
    expect(readOrgAttrsFromTag(tag)).toEqual({ owner: 'Ahmed', ownerType: 'individual' })
  })

  it('reads single-quoted attributes', () => {
    const tag = "<bpmn:task orbitpm:owner='Sara' orbitpm:ownerRole='A'>"
    expect(readOrgAttrsFromTag(tag)).toEqual({ owner: 'Sara', ownerRole: 'A' })
  })

  it('decodes XML entities in values', () => {
    const tag = '<bpmn:task orbitpm:owner="A &amp; B" orbitpm:channelDetail="x &lt; y">'
    const props = readOrgAttrsFromTag(tag)
    expect(props.owner).toBe('A & B')
    expect(props.channelDetail).toBe('x < y')
  })

  it('omits absent attributes and keeps an explicit empty value', () => {
    const tag = '<bpmn:task orbitpm:channel="">'
    const props = readOrgAttrsFromTag(tag)
    expect(props.channel).toBe('')
    expect('owner' in props).toBe(false)
    expect(readOrgAttrsFromTag('<bpmn:task id="x">')).toEqual({})
  })

  it('reads the full contract matrix in one tag', () => {
    const tag =
      '<bpmn:startEvent orbitpm:owner="O" orbitpm:ownerType="division" orbitpm:ownerRole="R" ' +
      'orbitpm:channel="dmthub" orbitpm:channelDetail="d" orbitpm:kind="cc" orbitpm:ccTo="cc" ' +
      'orbitpm:trigger="email" orbitpm:triggerService="svc" orbitpm:triggerDetail="td" ' +
      'orbitpm:triggers="email — svc — td\nmanual" ' +
      'orbitpm:nameEn="Review" orbitpm:nameAr="مراجعة" orbitpm:activeLang="ar" ' +
      'orbitpm:inputs="Form A" orbitpm:outputs="Out" orbitpm:system="ERP" ' +
      'orbitpm:respList="Sara — Approver" orbitpm:ccList="Legal" orbitpm:decisionBasis="Policy 4.2">'
    expect(readOrgAttrsFromTag(tag)).toEqual({
      owner: 'O',
      ownerType: 'division',
      ownerRole: 'R',
      channel: 'dmthub',
      channelDetail: 'd',
      kind: 'cc',
      ccTo: 'cc',
      trigger: 'email',
      triggerService: 'svc',
      triggerDetail: 'td',
      triggers: 'email — svc — td\nmanual',
      nameEn: 'Review',
      nameAr: 'مراجعة',
      activeLang: 'ar',
      inputs: 'Form A',
      outputs: 'Out',
      system: 'ERP',
      respList: 'Sara — Approver',
      ccList: 'Legal',
      decisionBasis: 'Policy 4.2'
    })
  })

  it('reads every paired 0.4.5 projection and language attribute', () => {
    const attributes = Object.entries(PAIRED_CONTRACT_PROPS)
      .map(([key, value]) => `orbitpm:${key}="${value}"`)
      .join(' ')
    expect(readOrgAttrsFromTag(`<bpmn:task ${attributes}>`)).toEqual(PAIRED_CONTRACT_PROPS)
  })
})

// --- getOrgProps ------------------------------------------------------------

describe('getOrgProps', () => {
  it('reads from businessObject.$attrs (extension NOT registered)', () => {
    const element = {
      businessObject: {
        $type: 'bpmn:Task',
        $attrs: { 'orbitpm:owner': 'Ahmed', 'orbitpm:kind': 'cc', 'orbitpm:channel': '' }
      }
    }
    // empty-string attr is treated as absent
    expect(getOrgProps(element)).toEqual({ owner: 'Ahmed', kind: 'cc' })
  })

  it('reads from businessObject.get() (extension registered)', () => {
    const values: Record<string, unknown> = {
      'orbitpm:owner': 'Sara',
      'orbitpm:ownerRole': 'A',
      'orbitpm:channel': 'email'
    }
    const element = {
      businessObject: {
        $type: 'bpmn:UserTask',
        get: (name: string) => values[name]
      }
    }
    expect(getOrgProps(element)).toEqual({ owner: 'Sara', ownerRole: 'A', channel: 'email' })
  })

  it('returns {} when there is no business object', () => {
    expect(getOrgProps({})).toEqual({})
    expect(getOrgProps(undefined)).toEqual({})
  })
})

// --- setOrgProps ------------------------------------------------------------

describe('setOrgProps', () => {
  it('emits the full attribute payload, mapping empty/undefined to undefined', () => {
    const { modeler, rec } = makeModeler({})
    const element = { id: 'T1' }
    const patch: OrgProps = { owner: 'Ahmed', ownerRole: 'A', channel: '', kind: 'cc' }
    setOrgProps(modeler, element, patch)

    expect(rec.updateProperties).toHaveLength(1)
    const call = rec.updateProperties[0]
    expect(call.element).toBe(element)
    expect(Object.keys(call.properties).sort()).toEqual(
      ORG_ATTR_NAMES.map((name) => `orbitpm:${name}`).sort()
    )
    expect(call.properties).toMatchObject({
      'orbitpm:owner': 'Ahmed',
      'orbitpm:ownerRole': 'A',
      'orbitpm:channel': undefined, // '' -> undefined (removes attr)
      'orbitpm:kind': 'cc'
    })
    expect(call.properties['orbitpm:ownerAr']).toBeUndefined()
    expect(call.properties['orbitpm:notesAr']).toBeUndefined()
  })

  it('writes every paired and legacy attribute under its prefixed name', () => {
    const { modeler, rec } = makeModeler({})
    const patch: OrgProps = {
      ...PAIRED_CONTRACT_PROPS,
      nameEn: 'Review request',
      nameAr: 'مراجعة الطلب',
      activeLang: 'ar',
      ownerType: 'department',
      channel: 'dmthub',
      kind: 'cc',
      trigger: 'dmthub'
    }
    setOrgProps(modeler, { id: 'T2' }, patch)
    const properties = rec.updateProperties[0].properties
    for (const [key, value] of Object.entries(patch)) {
      expect(properties[`orbitpm:${key}`]).toBe(value)
    }
  })
})

describe('mergeActiveLanguageOrgProps', () => {
  it('updates every active pair while retaining every opposite-language pair', () => {
    const current: OrgProps = {}
    const edited: OrgProps = {}
    for (const field of PAIRED_ORG_PROJECTION_FIELDS) {
      current[field.projection] = `old-${field.projection}`
      current[field.en] = `en-${field.projection}`
      current[field.ar] = `ar-${field.projection}`
      edited[field.projection] = `edited-${field.projection}`
    }
    Object.assign(edited, {
      ownerType: 'department',
      channel: 'dmthub',
      kind: 'cc',
      trigger: 'email',
      activeLang: 'ar'
    })

    const merged = mergeActiveLanguageOrgProps(current, edited, 'ar')

    for (const field of PAIRED_ORG_PROJECTION_FIELDS) {
      expect(merged[field.projection]).toBe(`edited-${field.projection}`)
      expect(merged[field.ar]).toBe(`edited-${field.projection}`)
      expect(merged[field.en]).toBe(`en-${field.projection}`)
    }
    expect(merged).toMatchObject({
      ownerType: 'department',
      channel: 'dmthub',
      kind: 'cc',
      trigger: 'email',
      activeLang: 'ar'
    })
    expect(merged).not.toHaveProperty('channelEn')
    expect(merged).not.toHaveProperty('triggerEn')
  })

  it('keeps canonical trigger and row-zero mirrors coherent without translating the type code', () => {
    const current: OrgProps = {
      triggersAr: 'email — البريد — قديم',
      triggerServiceAr: 'البريد',
      triggerDetailAr: 'قديم'
    }
    const serialized = serializeTriggers([
      { type: 'dmthub', service: 'Case Hub', detail: 'new case' },
      { type: 'manual', service: 'Desk', detail: 'exception' }
    ])

    expect(mergeActiveLanguageOrgProps(current, serialized, 'en')).toMatchObject({
      trigger: 'dmthub',
      triggerService: 'Case Hub',
      triggerServiceEn: 'Case Hub',
      triggerServiceAr: 'البريد',
      triggerDetail: 'new case',
      triggerDetailEn: 'new case',
      triggerDetailAr: 'قديم',
      triggers: 'dmthub — Case Hub — new case\nmanual — Desk — exception',
      triggersEn: 'dmthub — Case Hub — new case\nmanual — Desk — exception',
      triggersAr: 'email — البريد — قديم'
    })
  })

  it('clears only the edited active projection and pair', () => {
    expect(
      mergeActiveLanguageOrgProps(
        {
          owner: 'Operations',
          ownerEn: 'Operations',
          ownerAr: 'العمليات'
        },
        { owner: '' },
        'en'
      )
    ).toEqual({
      owner: '',
      ownerEn: '',
      ownerAr: 'العمليات'
    })
  })
})

// --- wave-G attr round-trips ------------------------------------------------

describe('new attribute round-trips (setOrgProps payload -> getOrgProps)', () => {
  const NEW_PROPS: OrgProps = {
    ...PAIRED_CONTRACT_PROPS,
    nameEn: 'Review request',
    nameAr: 'مراجعة الطلب',
    activeLang: 'en',
    ownerType: 'department',
    channel: 'dmthub',
    kind: 'cc',
    trigger: 'dmthub'
  }

  it('round-trips through $attrs (extension NOT registered)', () => {
    const { modeler, rec } = makeModeler({})
    setOrgProps(modeler, { id: 'T1' }, NEW_PROPS)
    // Re-materialise what updateProperties wrote as a $attrs bag…
    const $attrs: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(rec.updateProperties[0].properties)) {
      if (value !== undefined) $attrs[name] = value
    }
    // …and read it back.
    expect(getOrgProps({ businessObject: { $type: 'bpmn:Task', $attrs } })).toEqual(NEW_PROPS)
  })

  it('round-trips through bo.get() (extension registered)', () => {
    const { modeler, rec } = makeModeler({})
    setOrgProps(modeler, { id: 'T1' }, NEW_PROPS)
    const written = rec.updateProperties[0].properties
    const element = {
      businessObject: {
        $type: 'bpmn:Task',
        get: (name: string) => written[name]
      }
    }
    expect(getOrgProps(element)).toEqual(NEW_PROPS)
  })

  it('reads each new attribute individually from $attrs', () => {
    for (const [key, value] of Object.entries(NEW_PROPS)) {
      const element = {
        businessObject: { $type: 'bpmn:Task', $attrs: { ['orbitpm:' + key]: value } }
      }
      expect(getOrgProps(element)).toEqual({ [key]: value })
    }
  })
})

// --- splitList / joinList ----------------------------------------------------

describe('splitList / joinList', () => {
  it('splitList splits on newlines, trims, and drops blank entries', () => {
    expect(splitList('Form A\n  Customer file \n\n\nID copy')).toEqual([
      'Form A',
      'Customer file',
      'ID copy'
    ])
  })

  it('splitList maps empty-ish input to []', () => {
    expect(splitList('')).toEqual([])
    expect(splitList(undefined)).toEqual([])
    expect(splitList(null)).toEqual([])
    expect(splitList('  \n  ')).toEqual([])
  })

  it('joinList trims, drops blanks, and joins with a newline', () => {
    expect(joinList([' Legal ', '', 'Finance'])).toBe('Legal\nFinance')
    expect(joinList([])).toBe('')
  })

  it('round-trips: splitList(joinList(entries)) === cleaned entries', () => {
    const entries = ['Sara — Approver', 'Omar', 'Aisha — Reviewer']
    expect(splitList(joinList(entries))).toEqual(entries)
  })
})

// --- repeatable triggers ----------------------------------------------------

describe('parseTriggers / serializeTriggers', () => {
  it('exposes the canonical trigger types in dialog order', () => {
    expect(TRIGGER_TYPES).toEqual(['email', 'dmthub', 'manual', 'schedule', 'other'])
  })

  it('round-trips multiple rows and writes the first-row legacy mirror', () => {
    const entries = [
      { type: 'dmthub', service: 'ClaimsHub', detail: 'new claim' },
      { type: 'email', service: '', detail: 'sender allow-list' },
      { type: 'manual', service: '', detail: '' }
    ]
    const props = serializeTriggers(entries)
    expect(props).toEqual({
      triggers: 'dmthub — ClaimsHub — new claim\nemail —  — sender allow-list\nmanual',
      trigger: 'dmthub',
      triggerService: 'ClaimsHub',
      triggerDetail: 'new claim'
    })
    expect(parseTriggers(props)).toEqual(entries)
  })

  it('loads a legacy-only file as one row, then saves list plus mirror', () => {
    const legacy = {
      trigger: 'email',
      triggerService: 'Mailroom',
      triggerDetail: 'intake'
    }
    const entries = parseTriggers(legacy)
    expect(entries).toEqual([{ type: 'email', service: 'Mailroom', detail: 'intake' }])
    expect(serializeTriggers(entries)).toEqual({
      triggers: 'email — Mailroom — intake',
      trigger: 'email',
      triggerService: 'Mailroom',
      triggerDetail: 'intake'
    })
  })

  it('prefers a non-empty list over conflicting legacy values', () => {
    expect(
      parseTriggers({
        triggers: 'manual\nschedule —  — nightly',
        trigger: 'email',
        triggerService: 'Legacy',
        triggerDetail: 'ignored'
      })
    ).toEqual([
      { type: 'manual', service: '', detail: '' },
      { type: 'schedule', service: '', detail: 'nightly' }
    ])
  })

  it('keeps separators after the second one inside detail', () => {
    const props = {
      triggers: 'other — source — alpha — beta — gamma',
      trigger: '',
      triggerService: '',
      triggerDetail: ''
    }
    const entries = parseTriggers(props)
    expect(entries).toEqual([{ type: 'other', service: 'source', detail: 'alpha — beta — gamma' }])
    expect(parseTriggers(serializeTriggers(entries))).toEqual(entries)
  })

  it('drops invalid list types defensively', () => {
    expect(
      parseTriggers({
        triggers: 'email\ninvalid — service — detail\nmanual',
        trigger: 'dmthub',
        triggerService: 'legacy',
        triggerDetail: ''
      })
    ).toEqual([
      { type: 'email', service: '', detail: '' },
      { type: 'manual', service: '', detail: '' }
    ])
  })

  it('serializes empty input to all four empty keys', () => {
    expect(serializeTriggers([])).toEqual({
      triggers: '',
      trigger: '',
      triggerService: '',
      triggerDetail: ''
    })
    expect(serializeTriggers([{ type: '', service: 'orphan', detail: 'orphan' }])).toEqual({
      triggers: '',
      trigger: '',
      triggerService: '',
      triggerDetail: ''
    })
  })

  it('round-trips an empty service with a non-empty detail', () => {
    const entries = [{ type: 'schedule', service: '', detail: 'weekdays at 09:00' }]
    expect(serializeTriggers(entries).triggers).toBe('schedule —  — weekdays at 09:00')
    expect(parseTriggers(serializeTriggers(entries))).toEqual(entries)
  })
})

// --- process element / props / documentation --------------------------------

describe('process helpers', () => {
  it('getProcessElement returns the root when it is a Process', () => {
    const root: OrgElementLike = {
      id: 'Process_1',
      type: 'bpmn:Process',
      businessObject: { $type: 'bpmn:Process', $attrs: { 'orbitpm:owner': 'Div A' } }
    }
    const { modeler } = makeModeler({ root })
    expect(getProcessElement(modeler)).toBe(root)
    expect(getProcessOrgProps(modeler)).toEqual({ owner: 'Div A' })
  })

  it('getProcessElement follows the first participant processRef in a collaboration', () => {
    const processRef = { $type: 'bpmn:Process', $attrs: { 'orbitpm:ownerType': 'department' } }
    const root: OrgElementLike = {
      id: 'Collab_1',
      type: 'bpmn:Collaboration',
      businessObject: { $type: 'bpmn:Collaboration', participants: [{ processRef }] }
    }
    const { modeler } = makeModeler({ root })
    expect(getProcessElement(modeler)).toBe(processRef)
    expect(getProcessOrgProps(modeler)).toEqual({ ownerType: 'department' })
  })

  it('setProcessOrgProps writes onto the process element', () => {
    const root: OrgElementLike = {
      id: 'Process_1',
      type: 'bpmn:Process',
      businessObject: { $type: 'bpmn:Process' }
    }
    const { modeler, rec } = makeModeler({ root })
    setProcessOrgProps(modeler, { owner: 'Ops', ownerType: 'division' })
    expect(rec.updateProperties[0].element).toBe(root)
    expect(rec.updateProperties[0].properties['orbitpm:owner']).toBe('Ops')
    expect(rec.updateProperties[0].properties['orbitpm:ownerType']).toBe('division')
  })

  it('getProcessDocumentation returns the first documentation text or ""', () => {
    const withDoc: OrgElementLike = {
      type: 'bpmn:Process',
      businessObject: { $type: 'bpmn:Process', documentation: [{ text: 'hello' }] }
    }
    expect(getProcessDocumentation(makeModeler({ root: withDoc }).modeler)).toBe('hello')

    const noDoc: OrgElementLike = {
      type: 'bpmn:Process',
      businessObject: { $type: 'bpmn:Process' }
    }
    expect(getProcessDocumentation(makeModeler({ root: noDoc }).modeler)).toBe('')
  })

  it('setProcessDocumentation creates a Documentation for non-empty text, [] for empty', () => {
    const root: OrgElementLike = {
      type: 'bpmn:Process',
      businessObject: { $type: 'bpmn:Process' }
    }
    const { modeler, rec } = makeModeler({ root })

    setProcessDocumentation(modeler, 'a note')
    expect(rec.created).toEqual([{ type: 'bpmn:Documentation', attrs: { text: 'a note' } }])
    const docs = rec.updateProperties[0].properties.documentation as Array<{ text?: string }>
    expect(docs).toHaveLength(1)
    expect(docs[0].text).toBe('a note')

    setProcessDocumentation(modeler, '')
    expect(rec.updateProperties[1].properties).toEqual({ documentation: [] })
  })
})

// --- linked note ------------------------------------------------------------

describe('linked note (TextAnnotation via Association)', () => {
  function scenario(): {
    step: OrgElementLike
    annotation: OrgElementLike
    association: OrgElementLike
  } {
    const step: OrgElementLike = {
      id: 'Task_1',
      type: 'bpmn:Task',
      x: 100,
      y: 100,
      width: 100,
      height: 80
    }
    const annotation: OrgElementLike = {
      id: 'Ann_1',
      type: 'bpmn:TextAnnotation',
      businessObject: { $type: 'bpmn:TextAnnotation', text: 'see policy 4.2' }
    }
    const association: OrgElementLike = {
      id: 'Assoc_1',
      type: 'bpmn:Association',
      source: step,
      target: annotation
    }
    return { step, annotation, association }
  }

  it('getLinkedNote finds the annotation joined to the element in either direction', () => {
    const { step, annotation, association } = scenario()
    const { modeler } = makeModeler({ elements: [step, annotation, association] })
    expect(getLinkedNote(modeler, step)).toEqual({ annotationId: 'Ann_1', text: 'see policy 4.2' })

    // reversed association direction
    association.source = annotation
    association.target = step
    expect(getLinkedNote(modeler, step)).toEqual({ annotationId: 'Ann_1', text: 'see policy 4.2' })
  })

  it('getLinkedNote returns null when nothing is linked', () => {
    const step: OrgElementLike = { id: 'Task_9', type: 'bpmn:Task' }
    const { modeler } = makeModeler({ elements: [step] })
    expect(getLinkedNote(modeler, step)).toBeNull()
  })

  it('setStepNote updates the existing annotation text', () => {
    const { step, annotation, association } = scenario()
    const { modeler, rec } = makeModeler({ elements: [step, annotation, association] })
    setStepNote(modeler, step, 'updated')
    expect(rec.updateProperties).toEqual([{ element: annotation, properties: { text: 'updated' } }])
    expect(rec.createShape).toHaveLength(0)
  })

  it('setStepNote removes the annotation when text is emptied', () => {
    const { step, annotation, association } = scenario()
    const { modeler, rec } = makeModeler({ elements: [step, annotation, association] })
    setStepNote(modeler, step, '')
    expect(rec.removeElements).toEqual([[annotation]])
    expect(rec.updateProperties).toHaveLength(0)
  })

  it('setStepNote creates + connects a new annotation when none exists', () => {
    const step: OrgElementLike = {
      id: 'Task_2',
      type: 'bpmn:Task',
      x: 200,
      y: 150,
      width: 100,
      height: 80
    }
    const root: OrgElementLike = { id: 'Process_1', type: 'bpmn:Process' }
    const newAnnotation: OrgElementLike = { id: 'Ann_new', type: 'bpmn:TextAnnotation' }
    const { modeler, rec } = makeModeler({ elements: [step], root, nextShape: newAnnotation })

    setStepNote(modeler, step, 'brand new')

    expect(rec.createShape).toHaveLength(1)
    expect(rec.createShape[0].attrs).toEqual({ type: 'bpmn:TextAnnotation' })
    expect(rec.createShape[0].bounds).toEqual({
      x: 200 + 100 + 90,
      y: 150 - 60,
      width: 140,
      height: 60
    })
    expect(rec.createShape[0].target).toBe(root)
    expect(rec.updateProperties).toEqual([
      { element: newAnnotation, properties: { text: 'brand new' } }
    ])
    expect(rec.connect).toHaveLength(1)
    expect(rec.connect[0].source).toBe(step)
    expect(rec.connect[0].target).toBe(newAnnotation)
    expect(rec.connect[0].attrs).toEqual({ type: 'bpmn:Association' })
  })

  it('updates only the active annotation pair and retains the opposite pair', () => {
    const { step, annotation, association } = scenario()
    annotation.businessObject = {
      $type: 'bpmn:TextAnnotation',
      text: 'old',
      $attrs: {
        'orbitpm:nameEn': 'English note',
        'orbitpm:nameAr': 'ملاحظة قديمة',
        'vendor:future': 'keep'
      }
    }
    const { modeler, rec } = makeModeler({ elements: [step, annotation, association] })

    setStepNote(modeler, step, 'ملاحظة جديدة', 'ar')

    expect(rec.updateProperties).toEqual([
      {
        element: annotation,
        properties: {
          text: 'ملاحظة جديدة',
          'orbitpm:nameAr': 'ملاحظة جديدة'
        }
      }
    ])
    expect(rec.updateProperties[0].properties).not.toHaveProperty('orbitpm:nameEn')
    expect(annotation.businessObject.$attrs).toEqual({
      'orbitpm:nameEn': 'English note',
      'orbitpm:nameAr': 'ملاحظة قديمة',
      'vendor:future': 'keep'
    })
  })

  it('clears only the active note pair and projects the retained opposite language', () => {
    const { step, annotation, association } = scenario()
    annotation.businessObject = {
      $type: 'bpmn:TextAnnotation',
      text: 'English note',
      $attrs: {
        'orbitpm:nameEn': 'English note',
        'orbitpm:nameAr': 'ملاحظة عربية',
        'vendor:future': 'keep'
      }
    }
    const { modeler, rec } = makeModeler({ elements: [step, annotation, association] })

    setStepNote(modeler, step, '', 'en')

    expect(rec.removeElements).toHaveLength(0)
    expect(rec.updateProperties).toEqual([
      {
        element: annotation,
        properties: {
          text: 'ملاحظة عربية',
          'orbitpm:nameEn': undefined
        }
      }
    ])
    expect(rec.updateProperties[0].properties).not.toHaveProperty('orbitpm:nameAr')
    expect(annotation.businessObject.$attrs?.['orbitpm:nameAr']).toBe('ملاحظة عربية')
    expect(annotation.businessObject.$attrs?.['vendor:future']).toBe('keep')
  })

  it('removes a paired annotation only when the opposite language is empty', () => {
    const { step, annotation, association } = scenario()
    annotation.businessObject = {
      $type: 'bpmn:TextAnnotation',
      text: 'English note',
      $attrs: {
        'orbitpm:nameEn': 'English note',
        'orbitpm:nameAr': '   '
      }
    }
    const { modeler, rec } = makeModeler({ elements: [step, annotation, association] })

    setStepNote(modeler, step, '', 'en')

    expect(rec.removeElements).toEqual([[annotation]])
    expect(rec.updateProperties).toHaveLength(0)
  })

  it('creates the active annotation pair without guessing the opposite language', () => {
    const step: OrgElementLike = {
      id: 'Task_2',
      type: 'bpmn:Task',
      x: 200,
      y: 150,
      width: 100,
      height: 80
    }
    const root: OrgElementLike = { id: 'Process_1', type: 'bpmn:Process' }
    const newAnnotation: OrgElementLike = { id: 'Ann_new', type: 'bpmn:TextAnnotation' }
    const { modeler, rec } = makeModeler({ elements: [step], root, nextShape: newAnnotation })

    setStepNote(modeler, step, 'New note', 'en')

    expect(rec.updateProperties).toEqual([
      {
        element: newAnnotation,
        properties: {
          text: 'New note',
          'orbitpm:nameEn': 'New note'
        }
      }
    ])
    expect(rec.updateProperties[0].properties).not.toHaveProperty('orbitpm:nameAr')
  })

  it('setStepNote is a no-op when emptying a step with no annotation', () => {
    const step: OrgElementLike = { id: 'Task_3', type: 'bpmn:Task' }
    const { modeler, rec } = makeModeler({ elements: [step] })
    setStepNote(modeler, step, '')
    expect(rec.updateProperties).toHaveLength(0)
    expect(rec.createShape).toHaveLength(0)
    expect(rec.removeElements).toHaveLength(0)
  })
})
