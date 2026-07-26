import { describe, expect, it } from 'vitest'
import { validateBpmnXml } from '../../validation'
import { transform } from '../transform'
import {
  deriveGenerationIdentity,
  generateBpmnXml
} from '../xml'
import {
  BpmnLayoutValidationError,
  layoutBpmnValidated
} from '../layout'
import { bilingualGatewayIr, bilingualLinearIr } from './fixtures'

describe('safe BPMN XML generation', () => {
  it('derives stable non-constant document identity and a valid target namespace', () => {
    const ir = bilingualLinearIr()
    const first = deriveGenerationIdentity(ir)
    const second = deriveGenerationIdentity(structuredClone(ir))
    expect(first).toEqual(second)
    expect(first.processId).toMatch(/^Process_[a-f0-9]{16}$/)
    expect(first.definitionsId).toMatch(/^Definitions_[a-f0-9]{16}$/)
    expect(first.targetNamespace).toBe(
      `https://orbitpm.ae/bpmn/${first.processId}`
    )
    expect(first.processId).not.toBe('Process_1')
    expect(first.definitionsId).not.toBe('definitions_1')
  })

  it('deduplicates derived process IDs against the live workspace catalog', () => {
    const ir = bilingualLinearIr()
    const base = deriveGenerationIdentity(ir, { identitySeed: 'same description' })
    const deduplicated = deriveGenerationIdentity(ir, {
      identitySeed: 'same description',
      existingProcessIds: [base.processId, `${base.processId}_2`]
    })
    expect(deduplicated.processId).toBe(`${base.processId}_3`)
    expect(deduplicated.targetNamespace).toContain(`${base.processId}_3`)
    expect(() =>
      deriveGenerationIdentity(ir, {
        processId: 'Process_fixed',
        existingProcessIds: ['Process_fixed']
      })
    ).toThrow('already exists in the workspace')
  })

  it('honors stable caller-owned identity and rejects identity collisions', () => {
    const ir = bilingualLinearIr()
    const xml = generateBpmnXml(ir, {
      processId: 'Process_order_review',
      definitionsId: 'Definitions_order_review',
      targetNamespace: 'urn:orbitpm:order-review'
    })
    expect(xml).toContain('id="Definitions_order_review"')
    expect(xml).toContain('<process id="Process_order_review"')
    expect(xml).toContain('targetNamespace="urn:orbitpm:order-review"')

    expect(() => generateBpmnXml(ir, { processId: 'Start' })).toThrow(
      'identity collides'
    )
  })

  it('allocates globally unique synthetic join, flow and event-definition IDs', () => {
    const ir = bilingualGatewayIr()
    const gateway = ir[1]
    if (gateway.type !== 'exclusiveGateway') throw new Error('fixture')
    gateway.branches[0].path.unshift({
      type: 'intermediateCatchEvent',
      id: 'Decision-join',
      label: 'Wait',
      labelEn: 'Wait',
      labelAr: 'انتظار',
      eventDefinition: 'timerEventDefinition'
    })
    // Deliberately reserve the preferred event-definition ID as a user ID.
    gateway.branches[1].path.unshift({
      type: 'task',
      id: 'timerEventDefinition_Decision-join',
      label: 'Reserved',
      labelEn: 'Reserved',
      labelAr: 'محجوز'
    })

    const transformed = transform(ir)
    const ids = [
      ...transformed.elements.flatMap((element) => [
        element.id,
        ...(element.event_definition_id ? [element.event_definition_id] : [])
      ]),
      ...transformed.flows.map((flow) => flow.id)
    ]
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('Decision-join_2')
    expect(ids).toContain('timerEventDefinition_Decision-join_2')
    for (const flow of transformed.flows) {
      expect(transformed.elements.some((element) => element.id === flow.sourceRef)).toBe(true)
      expect(transformed.elements.some((element) => element.id === flow.targetRef)).toBe(true)
    }

    const xml = generateBpmnXml(ir, { identitySeed: 'collision-fixture' })
    const serializedIds = [...xml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(serializedIds).size).toBe(serializedIds.length)
  })

  it('emits real formal conditions and a condition-free resolved default flow', async () => {
    const xml = generateBpmnXml(bilingualGatewayIr(), {
      identitySeed: 'gateway-fixture'
    })
    expect(xml).toContain('<conditionExpression xsi:type="tFormalExpression">Approved</conditionExpression>')
    const defaultId = /<exclusiveGateway[^>]+default="([^"]+)"/.exec(xml)?.[1]
    expect(defaultId).toBeTruthy()
    const defaultTag = new RegExp(
      `<sequenceFlow id="${defaultId}"[^>]*(?:/>|>[\\s\\S]*?</sequenceFlow>)`
    ).exec(xml)?.[0]
    expect(defaultTag).toBeTruthy()
    expect(defaultTag).not.toContain('conditionExpression')

    const result = await validateBpmnXml(xml, { requireBilingual: true })
    expect(result.summary.valid).toBe(true)
    expect(result.summary.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.stringMatching(/sequence-ref|default|condition/)
        })
      ])
    )
  })

  it('emits paired organizational metadata that passes the shared strict audit', async () => {
    const ir = bilingualLinearIr()
    const review = ir[1]
    if (review.type !== 'userTask') throw new Error('fixture')
    Object.assign(review, {
      owner: 'Procurement Section',
      ownerEn: 'Procurement Section',
      ownerAr: 'قسم المشتريات',
      inputs: ['Purchase request'],
      inputsEn: ['Purchase request'],
      inputsAr: ['طلب الشراء']
    })
    const xml = generateBpmnXml(ir, { identitySeed: 'org-pairs' })
    expect(xml).toContain('orbitpm:ownerEn="Procurement Section"')
    expect(xml).toContain('orbitpm:ownerAr="قسم المشتريات"')
    expect(xml).toContain('orbitpm:inputsAr="طلب الشراء"')
    expect((await validateBpmnXml(xml, { requireBilingual: true })).summary.valid).toBe(
      true
    )
  })

  it('validates both sides of auto-layout and requires DI after layout', async () => {
    const semantic = generateBpmnXml(bilingualLinearIr(), {
      identitySeed: 'layout-fixture'
    })
    const result = await layoutBpmnValidated(semantic, {
      validation: { requireBilingual: true }
    })
    expect(result.preLayoutValidation.valid).toBe(true)
    expect(result.preLayoutValidation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'di.process-missing', blocking: false })
      ])
    )
    expect(result.postLayoutValidation.valid).toBe(true)
    expect(result.postLayoutValidation.stats.diagrams).toBeGreaterThan(0)
    expect(result.xml).toContain('BPMNDiagram')
  })

  it('fails closed when layout returns XML without DI', async () => {
    const semantic = generateBpmnXml(bilingualLinearIr(), {
      identitySeed: 'bad-layout-fixture'
    })
    await expect(
      layoutBpmnValidated(semantic, {
        validation: { requireBilingual: true },
        layout: async (xml) => xml
      })
    ).rejects.toMatchObject({
      name: 'BpmnLayoutValidationError',
      stage: 'post-layout'
    } satisfies Partial<BpmnLayoutValidationError>)
  })

  it('rejects semantic errors before invoking layout', async () => {
    const semantic = generateBpmnXml(bilingualLinearIr(), {
      identitySeed: 'pre-layout-fixture'
    }).replace('targetRef="Review"', 'targetRef="Missing"')
    let invoked = false
    await expect(
      layoutBpmnValidated(semantic, {
        layout: async (xml) => {
          invoked = true
          return xml
        }
      })
    ).rejects.toMatchObject({ stage: 'pre-layout' })
    expect(invoked).toBe(false)
  })
})
