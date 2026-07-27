import { describe, expect, it } from 'vitest'
import { validateBpmn } from '../ir/validate'
import { bilingualGatewayIr, bilingualLinearIr } from './fixtures'

describe('generation IR safety', () => {
  it('checks IDs globally across nested branches', () => {
    const ir = bilingualGatewayIr()
    const gateway = ir[1]
    if (gateway.type !== 'exclusiveGateway') throw new Error('fixture')
    gateway.branches[0].path[0].id = 'Start'
    expect(() => validateBpmn(ir)).toThrow('Duplicate element ID found: Start')
  })

  it('requires XML NCName IDs', () => {
    const ir = bilingualLinearIr()
    ir[1].id = '1 invalid id'
    expect(() => validateBpmn(ir)).toThrow('expected an XML NCName')
  })

  it('rejects dangling explicit branch targets', () => {
    const ir = bilingualGatewayIr()
    const gateway = ir[1]
    if (gateway.type !== 'exclusiveGateway') throw new Error('fixture')
    gateway.branches[0].next = 'Does_not_exist'
    expect(() => validateBpmn(ir)).toThrow(
      "Gateway 'Decision' references unknown next element 'Does_not_exist'"
    )
  })

  it('enforces one condition-free default and conditions on every other branch', () => {
    const conditionedDefault = bilingualGatewayIr()
    const firstGateway = conditionedDefault[1]
    if (firstGateway.type !== 'exclusiveGateway') throw new Error('fixture')
    firstGateway.branches[1].condition = 'Otherwise'
    expect(() => validateBpmn(conditionedDefault)).toThrow(
      "Default branch in gateway 'Decision' must not have a condition"
    )

    const multipleDefaults = bilingualGatewayIr()
    const secondGateway = multipleDefaults[1]
    if (secondGateway.type !== 'exclusiveGateway') throw new Error('fixture')
    secondGateway.branches[0].is_default = true
    secondGateway.branches[0].condition = undefined
    secondGateway.branches[0].conditionEn = undefined
    secondGateway.branches[0].conditionAr = undefined
    expect(() => validateBpmn(multipleDefaults)).toThrow(
      "Gateway 'Decision' may have at most one default branch"
    )

    const missingCondition = bilingualGatewayIr()
    const thirdGateway = missingCondition[1]
    if (thirdGateway.type !== 'exclusiveGateway') throw new Error('fixture')
    thirdGateway.branches[0].condition = undefined
    expect(() => validateBpmn(missingCondition)).toThrow(
      "Non-default branch in gateway 'Decision' must have a condition"
    )
  })

  it('rejects empty or single-branch parallel gateways', () => {
    const ir = bilingualLinearIr()
    ir.splice(1, 1, {
      type: 'parallelGateway',
      id: 'Parallel',
      branches: [[]]
    })
    expect(() => validateBpmn(ir)).toThrow('at least two branches')
  })

  it('rejects an empty terminal branch with no resolvable continuation', () => {
    const ir = bilingualGatewayIr()
    const gateway = ir[1]
    if (gateway.type !== 'exclusiveGateway') throw new Error('fixture')
    gateway.has_join = false
    gateway.branches[1].path = []
    // Make the gateway terminal while retaining an end event in the other path.
    gateway.branches[0].path.push(ir[2])
    ir.splice(2, 1)
    expect(() => validateBpmn(ir)).toThrow(
      "Empty branch in gateway 'Decision' has no continuation target"
    )
  })
})
