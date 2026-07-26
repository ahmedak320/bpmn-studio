import { describe, expect, it } from 'vitest'
import {
  autoSizeAll,
  fitInteriorBox,
  installAutoSize,
  targetFor,
  wrapCount,
  type AutoSizeElementLike,
  type AutoSizeModeler
} from '../autoSize'

const UPDATE_LABEL_EVENT = 'commandStack.element.updateLabel.postExecuted'
const UPDATE_PROPERTIES_EVENT = 'commandStack.element.updateProperties.postExecuted'

interface FakeElement extends AutoSizeElementLike {
  id: string
}

interface ResizeRecord {
  element: AutoSizeElementLike
  bounds: { x: number; y: number; width: number; height: number }
}

function shape(
  id: string,
  type: string,
  name: string,
  overrides: Partial<FakeElement> = {}
): FakeElement {
  return {
    id,
    type,
    businessObject: { $type: type, name },
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    ...overrides
  }
}

function makeWorld(elements: FakeElement[] = []) {
  const handlers = new Map<string, Array<(event: unknown) => void>>()
  const offCalls: Array<{ event: string; callback: (event: unknown) => void }> = []
  const resizeRecords: ResizeRecord[] = []
  const eventBus = {
    on(event: string, callback: (event: unknown) => void): void {
      handlers.set(event, [...(handlers.get(event) ?? []), callback])
    },
    off(event: string, callback: (event: unknown) => void): void {
      offCalls.push({ event, callback })
      handlers.set(event, (handlers.get(event) ?? []).filter((item) => item !== callback))
    }
  }
  const modeling = {
    resizeShape(
      element: AutoSizeElementLike,
      bounds: { x: number; y: number; width: number; height: number }
    ): void {
      resizeRecords.push({ element, bounds })
      Object.assign(element, bounds)
    }
  }
  const modeler: AutoSizeModeler = {
    get(name: string): unknown {
      switch (name) {
        case 'eventBus':
          return eventBus
        case 'modeling':
          return modeling
        case 'elementRegistry':
          return { getAll: () => elements }
        default:
          throw new Error('unexpected service ' + name)
      }
    }
  }
  const fire = (event: string, payload: unknown): void => {
    for (const handler of handlers.get(event) ?? []) handler(payload)
  }
  const handlerCount = (event: string): number => (handlers.get(event) ?? []).length
  return { modeler, resizeRecords, offCalls, fire, handlerCount }
}

describe('wrapCount', () => {
  it('hard-splits a superlong word without looping', () => {
    const word = 'x'.repeat(10_000)
    expect(wrapCount(word, 13)).toBe(Math.ceil(word.length / 13))
    expect(wrapCount(word, 0)).toBe(word.length)
  })

  it('keeps explicit newlines as hard breaks and treats an all-blank name as empty', () => {
    expect(wrapCount('Alpha\nBeta', 20)).toBe(2)
    expect(wrapCount(' \n\t ', 20)).toBe(0)
  })
})

describe('fitInteriorBox', () => {
  it.each([
    ['', { w: 100, h: 80 }],
    ['Review', { w: 100, h: 80 }]
  ])('keeps %j at the 100x80 minimum', (name, expected) => {
    expect(fitInteriorBox(name, { reserveSubChip: false })).toEqual(expected)
  })

  it('widens a medium label before increasing its height', () => {
    const name = '1234567 1234567 1234567 1234567 1234567'
    const fit = fitInteriorBox(name, { reserveSubChip: false })
    expect(fit.w).toBeGreaterThan(100)
    expect(fit.w).toBeLessThanOrEqual(160)
    expect(fit.h).toBe(80)
  })

  it('caps width at 160 and applies the exact even-height formula to a long word', () => {
    const name = 'x'.repeat(100)
    const linesAtCap = wrapCount(name, Math.floor((160 - 14) / 6.5))
    let expectedHeight = Math.max(80, Math.ceil(linesAtCap * 14.4 + 14))
    if (expectedHeight % 2 !== 0) expectedHeight += 1
    expect(fitInteriorBox(name, { reserveSubChip: false })).toEqual({
      w: 160,
      h: expectedHeight
    })
    expect(expectedHeight).toBeGreaterThan(80)
  })

  it('adds chip clearance to the final height for the same long label', () => {
    const name = 'x'.repeat(100)
    const plain = fitInteriorBox(name, { reserveSubChip: false })
    const withChip = fitInteriorBox(name, { reserveSubChip: true })
    expect(withChip.w).toBe(160)
    expect(withChip.h).toBeGreaterThan(plain.h)
    expect(withChip.h).toBe(104)
  })

  it('counts wide hard-split glyph runs safely while retaining the legacy count as a floor', () => {
    const uppercase = 'C'.repeat(100)

    // The former 6.5px average sees five chunks; Chromium's 12px Arial
    // renderer fits only sixteen C glyphs per 146px line and draws seven.
    expect(wrapCount(uppercase, Math.floor((160 - 14) / 6.5))).toBe(5)
    expect(fitInteriorBox(uppercase, { reserveSubChip: false })).toEqual({
      w: 160,
      h: 116
    })
    expect(fitInteriorBox(uppercase, { reserveSubChip: true })).toEqual({
      w: 160,
      h: 134
    })
  })

  it('matches the renderer hard-split back-off at an uppercase boundary length', () => {
    // A greedy 8.1px estimate could put eighteen As on each line and report
    // five lines. diagram-js backs off to seventeen and renders six.
    expect(wrapCount('A'.repeat(90), Math.floor((160 - 14) / 6.5))).toBe(5)
    expect(fitInteriorBox('A'.repeat(90), { reserveSubChip: true })).toEqual({
      w: 160,
      h: 120
    })
  })

  it('does not balloon the audited realistic call-activity sentence', () => {
    const name =
      'Review the complete delegated case and all supporting evidence before continuing'
    expect(fitInteriorBox(name, { reserveSubChip: true })).toEqual({ w: 160, h: 90 })
  })

  it('grows for a four-line capped label only when the bottom chip is reserved', () => {
    // Three lines fit even with the chip (75.2px total); four lines are the
    // first case that distinguishes the two 80px budgets.
    const name = Array(4).fill('12345678901234567890').join(' ')
    expect(fitInteriorBox(name, { reserveSubChip: false })).toEqual({ w: 150, h: 80 })
    expect(fitInteriorBox(name, { reserveSubChip: true })).toEqual({ w: 160, h: 90 })
  })

  it('fits Arabic text to finite positive dimensions', () => {
    const fit = fitInteriorBox('تسجيل ملف تعريف الحيوان الأليف الجديد في النظام', {
      reserveSubChip: false
    })
    expect(fit.w).toBeGreaterThanOrEqual(100)
    expect(fit.w).toBeLessThanOrEqual(160)
    expect(fit.h).toBeGreaterThan(0)
    expect(Number.isFinite(fit.w)).toBe(true)
    expect(Number.isFinite(fit.h)).toBe(true)
  })
})

describe('targetFor', () => {
  it('reserves the chip for calls and collapsed subprocesses but excludes expanded subprocesses', () => {
    const name = 'x'.repeat(100)
    const call = shape('Call_1', 'bpmn:CallActivity', name)
    const collapsed = shape('Sub_1', 'bpmn:SubProcess', name, { collapsed: true })
    const expanded = shape('Sub_2', 'bpmn:SubProcess', name, { collapsed: false })
    expect(targetFor(call)).toEqual(fitInteriorBox(name, { reserveSubChip: true }))
    expect(targetFor(collapsed)).toEqual(fitInteriorBox(name, { reserveSubChip: true }))
    expect(targetFor(expanded)).toBeNull()
  })
})

describe('installAutoSize', () => {
  it('resizes an updateLabel target with horizontal centre and top edge stable', () => {
    const world = makeWorld()
    installAutoSize(world.modeler)
    const task = shape('Task_1', 'bpmn:Task', 'x'.repeat(100))
    const label = shape('Task_1_label', 'bpmn:Label', '', {
      businessObject: task.businessObject,
      labelTarget: task
    })
    world.fire(UPDATE_LABEL_EVENT, { context: { element: label } })
    expect(world.resizeRecords).toEqual([
      {
        element: task,
        bounds: { x: -20, y: 20, width: 160, height: 86 }
      }
    ])
  })

  it('resizes updateProperties only when the properties bag contains name', () => {
    const world = makeWorld()
    installAutoSize(world.modeler)
    const withName = shape('Task_1', 'bpmn:Task', 'x'.repeat(100))
    const withoutName = shape('Task_2', 'bpmn:Task', 'x'.repeat(100))
    world.fire(UPDATE_PROPERTIES_EVENT, {
      context: { element: withoutName, properties: { 'orbitpm:nameEn': 'Stored only' } }
    })
    world.fire(UPDATE_PROPERTIES_EVENT, {
      context: { element: withName, properties: { name: withName.businessObject?.name } }
    })
    expect(world.resizeRecords).toHaveLength(1)
    expect(world.resizeRecords[0].element).toBe(withName)
  })

  it('ignores gateways, events, and expanded subprocesses', () => {
    const world = makeWorld()
    installAutoSize(world.modeler)
    const ignored = [
      shape('Gateway_1', 'bpmn:ExclusiveGateway', 'x'.repeat(100), { width: 50, height: 50 }),
      shape('Event_1', 'bpmn:StartEvent', 'x'.repeat(100), { width: 36, height: 36 }),
      shape('Sub_1', 'bpmn:SubProcess', 'x'.repeat(100), { collapsed: false })
    ]
    for (const element of ignored) {
      world.fire(UPDATE_LABEL_EVENT, { context: { element } })
    }
    expect(world.resizeRecords).toHaveLength(0)
  })

  it('skips a target already within one pixel of the desired size', () => {
    const world = makeWorld()
    installAutoSize(world.modeler)
    const task = shape('Task_1', 'bpmn:Task', 'Review', { width: 101, height: 79 })
    world.fire(UPDATE_LABEL_EVENT, { context: { element: task } })
    expect(world.resizeRecords).toHaveLength(0)
  })

  it('uninstalls both exact event handlers', () => {
    const world = makeWorld()
    const uninstall = installAutoSize(world.modeler)
    expect(world.handlerCount(UPDATE_LABEL_EVENT)).toBe(1)
    expect(world.handlerCount(UPDATE_PROPERTIES_EVENT)).toBe(1)
    uninstall()
    expect(world.handlerCount(UPDATE_LABEL_EVENT)).toBe(0)
    expect(world.handlerCount(UPDATE_PROPERTIES_EVENT)).toBe(0)
    expect(world.offCalls.map((call) => call.event)).toEqual([
      UPDATE_LABEL_EVENT,
      UPDATE_PROPERTIES_EVENT
    ])
  })
})

describe('autoSizeAll', () => {
  it('returns the count of registry elements actually resized', () => {
    const longTask = shape('Task_1', 'bpmn:Task', 'x'.repeat(100))
    const shortTask = shape('Task_2', 'bpmn:Task', 'Review')
    const call = shape('Call_1', 'bpmn:CallActivity', 'x'.repeat(100))
    const gateway = shape('Gateway_1', 'bpmn:ExclusiveGateway', 'x'.repeat(100), {
      width: 50,
      height: 50
    })
    const world = makeWorld([longTask, shortTask, call, gateway])
    expect(autoSizeAll(world.modeler)).toBe(2)
    expect(world.resizeRecords.map((record) => (record.element as FakeElement).id)).toEqual([
      'Task_1',
      'Call_1'
    ])
  })
})
