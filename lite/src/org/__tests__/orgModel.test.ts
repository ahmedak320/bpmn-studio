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
  splitList,
  joinList,
  type OrgProps,
  type OrgModeler,
  type OrgElementLike
} from '../orgModel'

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
    expect(call.properties).toEqual({
      'orbitpm:owner': 'Ahmed',
      'orbitpm:ownerType': undefined,
      'orbitpm:ownerRole': 'A',
      'orbitpm:channel': undefined, // '' -> undefined (removes attr)
      'orbitpm:channelDetail': undefined,
      'orbitpm:kind': 'cc',
      'orbitpm:ccTo': undefined,
      'orbitpm:trigger': undefined,
      'orbitpm:triggerService': undefined,
      'orbitpm:triggerDetail': undefined,
      'orbitpm:nameEn': undefined,
      'orbitpm:nameAr': undefined,
      'orbitpm:activeLang': undefined,
      'orbitpm:inputs': undefined,
      'orbitpm:outputs': undefined,
      'orbitpm:system': undefined,
      'orbitpm:respList': undefined,
      'orbitpm:ccList': undefined,
      'orbitpm:decisionBasis': undefined
    })
  })

  it('writes every wave-G attribute under its prefixed name', () => {
    const { modeler, rec } = makeModeler({})
    const patch: OrgProps = {
      nameEn: 'Review request',
      nameAr: 'مراجعة الطلب',
      activeLang: 'ar',
      inputs: 'Form A\nCustomer file',
      outputs: 'Approval memo',
      system: 'ERP',
      respList: 'Sara — Approver\nOmar',
      ccList: 'Legal\nFinance',
      decisionBasis: 'Policy 4.2'
    }
    setOrgProps(modeler, { id: 'T2' }, patch)
    const properties = rec.updateProperties[0].properties
    expect(properties['orbitpm:nameEn']).toBe('Review request')
    expect(properties['orbitpm:nameAr']).toBe('مراجعة الطلب')
    expect(properties['orbitpm:activeLang']).toBe('ar')
    expect(properties['orbitpm:inputs']).toBe('Form A\nCustomer file')
    expect(properties['orbitpm:outputs']).toBe('Approval memo')
    expect(properties['orbitpm:system']).toBe('ERP')
    expect(properties['orbitpm:respList']).toBe('Sara — Approver\nOmar')
    expect(properties['orbitpm:ccList']).toBe('Legal\nFinance')
    expect(properties['orbitpm:decisionBasis']).toBe('Policy 4.2')
  })
})

// --- wave-G attr round-trips ------------------------------------------------

describe('new attribute round-trips (setOrgProps payload -> getOrgProps)', () => {
  const NEW_PROPS: OrgProps = {
    nameEn: 'Review request',
    nameAr: 'مراجعة الطلب',
    activeLang: 'en',
    inputs: 'Form A\nCustomer file',
    outputs: 'Memo',
    system: 'DMT Hub',
    respList: 'Sara — Approver',
    ccList: 'Legal\nFinance\nAudit',
    decisionBasis: 'Delegation matrix §3'
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
    const step: OrgElementLike = { id: 'Task_1', type: 'bpmn:Task', x: 100, y: 100, width: 100, height: 80 }
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
    const step: OrgElementLike = { id: 'Task_2', type: 'bpmn:Task', x: 200, y: 150, width: 100, height: 80 }
    const root: OrgElementLike = { id: 'Process_1', type: 'bpmn:Process' }
    const newAnnotation: OrgElementLike = { id: 'Ann_new', type: 'bpmn:TextAnnotation' }
    const { modeler, rec } = makeModeler({ elements: [step], root, nextShape: newAnnotation })

    setStepNote(modeler, step, 'brand new')

    expect(rec.createShape).toHaveLength(1)
    expect(rec.createShape[0].attrs).toEqual({ type: 'bpmn:TextAnnotation' })
    expect(rec.createShape[0].bounds).toEqual({ x: 200 + 100 + 90, y: 150 - 60, width: 140, height: 60 })
    expect(rec.createShape[0].target).toBe(root)
    expect(rec.updateProperties).toEqual([{ element: newAnnotation, properties: { text: 'brand new' } }])
    expect(rec.connect).toHaveLength(1)
    expect(rec.connect[0].source).toBe(step)
    expect(rec.connect[0].target).toBe(newAnnotation)
    expect(rec.connect[0].attrs).toEqual({ type: 'bpmn:Association' })
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
