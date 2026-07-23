import { describe, it, expect } from 'vitest'
import type { CallLLM, LlmMessage } from '@app/gen'
import {
  collectMissingTranslations,
  translateDiagram,
  TRANSLATE_INSTRUCTION,
  TRANSLATE_MAX_TOKENS,
  type TranslateModeler
} from '../translate'

// translate.ts is deliberately bpmn-js-free — this suite runs with
// environment: 'node' (no jsdom, per vitest.config.ts) and drives the module
// through tiny hand-rolled fakes for elementRegistry/modeling/canvas (same
// recorder-fake style as src/__tests__/langToggle.test.ts) plus a canned-
// response fake CallLLM. No network, no bpmn-js.

// --- modeler fakes (mirrors langToggle.test.ts) ---------------------------

interface FakeBusinessObject {
  $type?: string
  name?: string
  $attrs?: Record<string, unknown>
  participants?: Array<{ processRef?: FakeBusinessObject }>
  get?: (name: string) => unknown
  [key: string]: unknown
}

interface FakeElement {
  id: string
  businessObject?: FakeBusinessObject
  labelTarget?: unknown
  waypoints?: unknown
}

interface RecordedUpdate {
  element: unknown
  properties: Record<string, unknown>
}

/**
 * Applies a properties bag onto a fake element's business object the same way
 * real bpmn-js would: `orbitpm:*` keys land in `$attrs` (the fakes model the
 * "extension not registered" world — see translate.ts's dual-world readers),
 * everything else is a direct property. A REAL mutation, not just a recorder,
 * so post-run state assertions see what a command stack would produce.
 */
function applyProperties(element: unknown, properties: Record<string, unknown>): void {
  const bo = (element as { businessObject?: FakeBusinessObject } | undefined)?.businessObject
  if (!bo) return
  for (const [key, value] of Object.entries(properties)) {
    if (key.startsWith('orbitpm:')) {
      bo.$attrs = { ...(bo.$attrs ?? {}), [key]: value as string }
    } else {
      bo[key] = value
    }
  }
}

function makeModeler(opts: { root?: FakeElement; elements?: FakeElement[] }): {
  modeler: TranslateModeler
  rec: RecordedUpdate[]
} {
  const rec: RecordedUpdate[] = []
  const canvas = { getRootElement: () => opts.root }
  const elementRegistry = { getAll: () => opts.elements ?? [] }
  const modeling = {
    updateProperties(element: unknown, properties: Record<string, unknown>): void {
      rec.push({ element, properties })
      applyProperties(element, properties)
    }
  }
  const modeler: TranslateModeler = {
    get(name: string): unknown {
      switch (name) {
        case 'canvas':
          return canvas
        case 'elementRegistry':
          return elementRegistry
        case 'modeling':
          return modeling
        default:
          throw new Error('unexpected service ' + name)
      }
    }
  }
  return { modeler, rec }
}

/** A bare (non-collaboration) process root — the common case. */
function processRoot(attrs: Record<string, unknown> = {}): FakeElement {
  return {
    id: 'Process_1',
    businessObject: { $type: 'bpmn:Process', $attrs: { ...attrs } }
  }
}

// --- CallLLM fakes ---------------------------------------------------------

interface RecordedCall {
  messages: LlmMessage[]
  options: { maxTokens: number }
}

type ResponseSpec = string | Record<string, unknown> | ((call: RecordedCall) => unknown)

/**
 * Canned-response CallLLM: each call consumes the next spec (a raw string, an
 * already-parsed object — CallLLM's contract allows both — or a function of
 * the recorded call for payload-echo responses). Running past the end throws,
 * so a test that provokes more calls than it scripted fails loudly.
 */
function makeCallLLM(responses: ResponseSpec[]): { callLLM: CallLLM; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const callLLM: CallLLM = async (messages, options) => {
    const call: RecordedCall = { messages, options }
    calls.push(call)
    const next = responses[calls.length - 1]
    if (next === undefined) throw new Error(`unexpected extra LLM call #${calls.length}`)
    return typeof next === 'function' ? next(call) : next
  }
  return { callLLM, calls }
}

/** Extract the {id: text} payload embedded in a prompt (its only JSON block). */
function payloadOf(call: RecordedCall): Record<string, string> {
  const content = call.messages[0].content
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  return JSON.parse(content.slice(start, end + 1)) as Record<string, string>
}

/** Echo-translators: valid per-direction responses derived from the payload. */
const echoAr = (call: RecordedCall): string =>
  JSON.stringify(
    Object.fromEntries(Object.entries(payloadOf(call)).map(([id, text]) => [id, `ترجمة ${text}`]))
  )
const echoEn = (call: RecordedCall): string =>
  JSON.stringify(Object.fromEntries(Object.keys(payloadOf(call)).map((id) => [id, `EN ${id}`])))

// --- element factories -----------------------------------------------------

/** Task with only the English side stored (the ARIS/DMT-export shape). */
function taskMissingAr(id: string, en: string): FakeElement {
  return {
    id,
    businessObject: { $type: 'bpmn:Task', name: en, $attrs: { 'orbitpm:nameEn': en } }
  }
}

/** Task with only the Arabic side stored (Arabic-authored shape). */
function taskMissingEn(id: string, ar: string): FakeElement {
  return {
    id,
    businessObject: { $type: 'bpmn:Task', name: ar, $attrs: { 'orbitpm:nameAr': ar } }
  }
}

// === collectMissingTranslations ============================================

describe('collectMissingTranslations', () => {
  it('produces both directions from one mixed diagram, skipping both-stored and unnamed elements', () => {
    const root = processRoot({ 'orbitpm:activeLang': 'en' })
    const missingAr = taskMissingAr('Task_A', 'Order')
    const missingEn = taskMissingEn('Task_B', 'طلب')
    const bothStored: FakeElement = {
      id: 'Task_C',
      businessObject: {
        $type: 'bpmn:Task',
        name: 'Ship',
        $attrs: { 'orbitpm:nameEn': 'Ship', 'orbitpm:nameAr': 'شحن' }
      }
    }
    // Neither attr stored — visible name seeds the ACTIVE (en) side at apply,
    // so collect emits ONE entry, for the other (ar) side.
    const bothMissing: FakeElement = {
      id: 'Task_D',
      businessObject: { $type: 'bpmn:Task', name: 'Plain' }
    }
    const unnamed: FakeElement = { id: 'Task_E', businessObject: { $type: 'bpmn:Task' } }
    const { modeler } = makeModeler({
      root,
      elements: [missingAr, missingEn, bothStored, bothMissing, unnamed]
    })

    expect(collectMissingTranslations(modeler)).toEqual([
      { id: 'Task_A', text: 'Order', target: 'ar' },
      { id: 'Task_B', text: 'طلب', target: 'en' },
      { id: 'Task_D', text: 'Plain', target: 'ar' }
    ])
  })

  it('uses the stored other-side value (not the visible name) as the source text', () => {
    // Hand-edited while ar was active: visible name diverged from the stored
    // ar attr. The entry's source is the STORED value — the visible-name
    // reconciliation is the toggle's write-back job, not translate's.
    const root = processRoot({ 'orbitpm:activeLang': 'ar' })
    const el: FakeElement = {
      id: 'Task_A',
      businessObject: { $type: 'bpmn:Task', name: 'طلب معدل', $attrs: { 'orbitpm:nameAr': 'طلب' } }
    }
    const { modeler } = makeModeler({ root, elements: [el] })

    expect(collectMissingTranslations(modeler)).toEqual([
      { id: 'Task_A', text: 'طلب', target: 'en' }
    ])
  })

  it('targets en for a both-missing element when the stored active language is ar', () => {
    const root = processRoot({ 'orbitpm:activeLang': 'ar' })
    const el: FakeElement = { id: 'Task_A', businessObject: { $type: 'bpmn:Task', name: 'مهمة' } }
    const { modeler } = makeModeler({ root, elements: [el] })

    expect(collectMissingTranslations(modeler)).toEqual([
      { id: 'Task_A', text: 'مهمة', target: 'en' }
    ])
  })

  it('detects the active language from labels when orbitpm:activeLang is absent (Arabic majority)', () => {
    const root = processRoot() // no activeLang stored
    const elA: FakeElement = { id: 'Task_A', businessObject: { $type: 'bpmn:Task', name: 'مهمة أولى' } }
    const elB: FakeElement = { id: 'Task_B', businessObject: { $type: 'bpmn:Task', name: 'مهمة ثانية' } }
    const { modeler } = makeModeler({ root, elements: [elA, elB] })

    // Majority-Arabic labels ⇒ active 'ar' ⇒ both-missing elements target 'en'.
    expect(collectMissingTranslations(modeler)).toEqual([
      { id: 'Task_A', text: 'مهمة أولى', target: 'en' },
      { id: 'Task_B', text: 'مهمة ثانية', target: 'en' }
    ])
  })

  it('detects en from majority-English labels when orbitpm:activeLang is absent', () => {
    const root = processRoot()
    const el: FakeElement = { id: 'Task_A', businessObject: { $type: 'bpmn:Task', name: 'Review order' } }
    const { modeler } = makeModeler({ root, elements: [el] })

    expect(collectMissingTranslations(modeler)).toEqual([
      { id: 'Task_A', text: 'Review order', target: 'ar' }
    ])
  })

  it('skips external labels — the shared business object is processed exactly once', () => {
    const root = processRoot({ 'orbitpm:activeLang': 'en' })
    const task = taskMissingAr('Task_A', 'Ship')
    const label: FakeElement = {
      id: 'Task_A_label',
      businessObject: task.businessObject, // labels SHARE their target's bo
      labelTarget: task
    }
    const { modeler } = makeModeler({ root, elements: [task, label] })

    expect(collectMissingTranslations(modeler)).toEqual([
      { id: 'Task_A', text: 'Ship', target: 'ar' }
    ])
  })

  it('includes connections (sequence-flow condition names)', () => {
    const root = processRoot({ 'orbitpm:activeLang': 'en' })
    const flow: FakeElement = {
      id: 'Flow_1',
      businessObject: {
        $type: 'bpmn:SequenceFlow',
        name: 'Approved',
        $attrs: { 'orbitpm:nameEn': 'Approved' }
      },
      waypoints: [
        { x: 0, y: 0 },
        { x: 100, y: 40 }
      ]
    }
    const { modeler } = makeModeler({ root, elements: [flow] })

    expect(collectMissingTranslations(modeler)).toEqual([
      { id: 'Flow_1', text: 'Approved', target: 'ar' }
    ])
  })

  it('includes the process root itself when the registry does not surface it', () => {
    const root: FakeElement = {
      id: 'Process_1',
      businessObject: {
        $type: 'bpmn:Process',
        name: 'Order Handling',
        $attrs: { 'orbitpm:activeLang': 'en' }
      }
    }
    const { modeler } = makeModeler({ root, elements: [taskMissingAr('Task_A', 'Order')] })

    expect(collectMissingTranslations(modeler)).toEqual([
      { id: 'Task_A', text: 'Order', target: 'ar' },
      { id: 'Process_1', text: 'Order Handling', target: 'ar' }
    ])
  })

  it('does not duplicate the root when the registry already contains it (shared business object)', () => {
    const root: FakeElement = {
      id: 'Process_1',
      businessObject: {
        $type: 'bpmn:Process',
        name: 'Main',
        $attrs: { 'orbitpm:activeLang': 'en' }
      }
    }
    const task = taskMissingAr('Task_A', 'Do work')
    // Real bpmn-js registries include the canvas root in getAll().
    const { modeler } = makeModeler({ root, elements: [root, task] })

    expect(collectMissingTranslations(modeler)).toEqual([
      { id: 'Process_1', text: 'Main', target: 'ar' },
      { id: 'Task_A', text: 'Do work', target: 'ar' }
    ])
  })

  it('resolves the collaboration root to the first participant processRef (id from the business object)', () => {
    const processRef: FakeBusinessObject = {
      $type: 'bpmn:Process',
      id: 'Process_9',
      name: 'عملية رئيسية',
      $attrs: { 'orbitpm:nameAr': 'عملية رئيسية', 'orbitpm:activeLang': 'ar' }
    }
    const root: FakeElement = {
      id: 'Collab_1',
      businessObject: { $type: 'bpmn:Collaboration', participants: [{ processRef }] }
    }
    const { modeler } = makeModeler({ root, elements: [] })

    expect(collectMissingTranslations(modeler)).toEqual([
      { id: 'Process_9', text: 'عملية رئيسية', target: 'en' }
    ])
  })

  it('reads stored attrs via businessObject.get() when the moddle extension is registered', () => {
    const values: Record<string, unknown> = { name: 'Order', 'orbitpm:nameEn': 'Order' }
    const el: FakeElement = {
      id: 'Task_G',
      businessObject: { $type: 'bpmn:Task', get: (key: string) => values[key] }
    }
    const { modeler } = makeModeler({ root: processRoot({ 'orbitpm:activeLang': 'en' }), elements: [el] })

    expect(collectMissingTranslations(modeler)).toEqual([
      { id: 'Task_G', text: 'Order', target: 'ar' }
    ])
  })

  it('is strictly read-only: no updateProperties calls, no seeded attrs', () => {
    const root = processRoot() // activeLang absent — still must not be stamped here
    const bothMissing: FakeElement = {
      id: 'Task_A',
      businessObject: { $type: 'bpmn:Task', name: 'Plain' }
    }
    const { modeler, rec } = makeModeler({ root, elements: [bothMissing] })

    collectMissingTranslations(modeler)

    expect(rec).toEqual([])
    expect(bothMissing.businessObject?.$attrs).toBeUndefined()
    expect(root.businessObject?.$attrs).toEqual({})
  })

  it('never emits entries with empty source text (whitespace-only names and attrs)', () => {
    const root = processRoot({ 'orbitpm:activeLang': 'en' })
    const blankName: FakeElement = {
      id: 'Task_A',
      businessObject: { $type: 'bpmn:Task', name: '   ' }
    }
    const blankSource: FakeElement = {
      id: 'Task_B',
      businessObject: { $type: 'bpmn:Task', name: 'X', $attrs: { 'orbitpm:nameAr': '   ' } }
    }
    const { modeler } = makeModeler({ root, elements: [blankName, blankSource] })

    expect(collectMissingTranslations(modeler)).toEqual([])
  })
})

// === translateDiagram ======================================================

describe('translateDiagram', () => {
  it('translates missing-ar entries in one call, with the documented prompt shape', async () => {
    const root = processRoot({ 'orbitpm:activeLang': 'en' })
    const elA = taskMissingAr('Task_A', 'Order')
    const elB = taskMissingAr('Task_B', 'Approve')
    const { modeler, rec } = makeModeler({ root, elements: [elA, elB] })
    const { callLLM, calls } = makeCallLLM(['{"Task_A":"طلب","Task_B":"موافقة"}'])

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 2, skipped: 0, total: 2 })
    // One chunk, one direction — a single-user-message prompt carrying the
    // system-style instruction, the direction line, and the {id: text} payload.
    expect(calls).toHaveLength(1)
    expect(calls[0].messages).toHaveLength(1)
    expect(calls[0].messages[0].role).toBe('user')
    expect(calls[0].messages[0].content.startsWith(TRANSLATE_INSTRUCTION)).toBe(true)
    expect(calls[0].messages[0].content).toContain('Target language for every value in this request: Arabic.')
    expect(calls[0].messages[0].content).toContain(
      JSON.stringify({ Task_A: 'Order', Task_B: 'Approve' })
    )
    expect(calls[0].options).toEqual({ maxTokens: TRANSLATE_MAX_TOKENS })
    // One updateProperties per element; visible names untouched; no activeLang
    // write since the flag is already stored.
    expect(rec).toEqual([
      { element: elA, properties: { 'orbitpm:nameAr': 'طلب' } },
      { element: elB, properties: { 'orbitpm:nameAr': 'موافقة' } }
    ])
    expect(elA.businessObject?.name).toBe('Order')
    expect(elA.businessObject?.$attrs).toEqual({ 'orbitpm:nameEn': 'Order', 'orbitpm:nameAr': 'طلب' })
  })

  it('bundles the write-back seed and the translation into ONE updateProperties for a both-missing element', async () => {
    const root = processRoot() // activeLang absent — will be stamped from detection
    const el: FakeElement = {
      id: 'Task_P',
      businessObject: { $type: 'bpmn:Task', name: 'Plain Name' }
    }
    const { modeler, rec } = makeModeler({ root, elements: [el] })
    const { callLLM } = makeCallLLM(['{"Task_P":"اسم عادي"}'])

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 1, skipped: 0, total: 1 })
    // Exact shapes: seed + translation in one element write, then the
    // detected activeLang stamped on the root as the separate final write.
    expect(rec).toEqual([
      {
        element: el,
        properties: { 'orbitpm:nameEn': 'Plain Name', 'orbitpm:nameAr': 'اسم عادي' }
      },
      { element: root, properties: { 'orbitpm:activeLang': 'en' } }
    ])
    expect(el.businessObject?.name).toBe('Plain Name') // visible name never changed
  })

  it('seeds the ar side and stamps activeLang ar for an Arabic-authored diagram (absent flag)', async () => {
    const root = processRoot()
    const el: FakeElement = { id: 'Task_Q', businessObject: { $type: 'bpmn:Task', name: 'مهمة' } }
    const { modeler, rec } = makeModeler({ root, elements: [el] })
    const { callLLM, calls } = makeCallLLM(['{"Task_Q":"Task"}'])

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 1, skipped: 0, total: 1 })
    expect(calls[0].messages[0].content).toContain('Target language for every value in this request: English.')
    expect(rec).toEqual([
      { element: el, properties: { 'orbitpm:nameAr': 'مهمة', 'orbitpm:nameEn': 'Task' } },
      { element: root, properties: { 'orbitpm:activeLang': 'ar' } }
    ])
  })

  it('accepts a markdown-fenced JSON response', async () => {
    const { modeler, rec } = makeModeler({
      root: processRoot({ 'orbitpm:activeLang': 'en' }),
      elements: [taskMissingAr('Task_A', 'Order')]
    })
    const { callLLM, calls } = makeCallLLM(['```json\n{"Task_A":"طلب"}\n```'])

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 1, skipped: 0, total: 1 })
    expect(calls).toHaveLength(1) // no retry needed
    expect(rec[0].properties).toEqual({ 'orbitpm:nameAr': 'طلب' })
  })

  it('accepts a prose-wrapped JSON response', async () => {
    const { modeler, rec } = makeModeler({
      root: processRoot({ 'orbitpm:activeLang': 'en' }),
      elements: [taskMissingAr('Task_A', 'Order')]
    })
    const { callLLM, calls } = makeCallLLM([
      'Sure! Here are the translations: {"Task_A":"طلب"} — hope that helps.'
    ])

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 1, skipped: 0, total: 1 })
    expect(calls).toHaveLength(1)
    expect(rec[0].properties).toEqual({ 'orbitpm:nameAr': 'طلب' })
  })

  it('retries ONCE with a terser reminder appended after an unparseable response', async () => {
    const { modeler, rec } = makeModeler({
      root: processRoot({ 'orbitpm:activeLang': 'en' }),
      elements: [taskMissingAr('Task_A', 'Order')]
    })
    const { callLLM, calls } = makeCallLLM([
      'I would be happy to translate these labels for you.', // no JSON at all
      '{"Task_A":"طلب"}'
    ])

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 1, skipped: 0, total: 1 })
    expect(calls).toHaveLength(2)
    // The retry is the SAME prompt with the reminder appended — still a single
    // user message, payload included.
    expect(calls[1].messages).toHaveLength(1)
    expect(calls[1].messages[0].content.startsWith(calls[0].messages[0].content)).toBe(true)
    expect(calls[1].messages[0].content).toContain('ONLY the JSON object')
    expect(rec[0].properties).toEqual({ 'orbitpm:nameAr': 'طلب' })
  })

  it('gives up on a chunk after two unparseable responses — entries count as skipped', async () => {
    const { modeler, rec } = makeModeler({
      root: processRoot({ 'orbitpm:activeLang': 'en' }),
      elements: [taskMissingAr('Task_A', 'Order'), taskMissingAr('Task_B', 'Approve')]
    })
    const { callLLM, calls } = makeCallLLM(['no json here', 'still no json'])

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 0, skipped: 2, total: 2 })
    expect(calls).toHaveLength(2) // first attempt + one retry, then give up
    expect(rec).toEqual([]) // nothing written — both elements untouched
  })

  it('still writes the seed when the chunk failed (both-missing element, active side adopted)', async () => {
    const root = processRoot({ 'orbitpm:activeLang': 'en' })
    const el: FakeElement = { id: 'Task_P', businessObject: { $type: 'bpmn:Task', name: 'Plain' } }
    const { modeler, rec } = makeModeler({ root, elements: [el] })
    const { callLLM } = makeCallLLM(['nope', 'still nope'])

    const outcome = await translateDiagram(modeler, callLLM)

    // The translation was skipped, but the write-back (exactly what the next
    // toggle would do anyway) still lands, so a re-run finds a clean state.
    expect(outcome).toEqual({ translated: 0, skipped: 1, total: 1 })
    expect(rec).toEqual([{ element: el, properties: { 'orbitpm:nameEn': 'Plain' } }])
  })

  it('skips entries missing from the response and applies the rest', async () => {
    const elA = taskMissingAr('Task_A', 'Order')
    const elB = taskMissingAr('Task_B', 'Approve')
    const { modeler, rec } = makeModeler({
      root: processRoot({ 'orbitpm:activeLang': 'en' }),
      elements: [elA, elB]
    })
    const { callLLM } = makeCallLLM(['{"Task_A":"طلب"}']) // Task_B omitted

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 1, skipped: 1, total: 2 })
    expect(rec).toEqual([{ element: elA, properties: { 'orbitpm:nameAr': 'طلب' } }])
  })

  it('rejects an ar-target translation without Arabic codepoints (non-acronym source)', async () => {
    const { modeler, rec } = makeModeler({
      root: processRoot({ 'orbitpm:activeLang': 'en' }),
      elements: [taskMissingAr('Task_A', 'Approve Order')]
    })
    const { callLLM } = makeCallLLM(['{"Task_A":"Approved!"}']) // English back — invalid

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 0, skipped: 1, total: 1 })
    expect(rec).toEqual([])
  })

  it('accepts an acronym-like source passed through unchanged for target ar', async () => {
    // No lowercase [a-z] in the source ⇒ digits/punctuation/acronym-like ⇒ an
    // Arabic-free (even identical) response is legitimate ("DMT HUB" stays).
    const el = taskMissingAr('Task_H', 'DMT HUB')
    const { modeler, rec } = makeModeler({
      root: processRoot({ 'orbitpm:activeLang': 'en' }),
      elements: [el]
    })
    const { callLLM } = makeCallLLM(['{"Task_H":"DMT HUB"}'])

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 1, skipped: 0, total: 1 })
    expect(rec).toEqual([{ element: el, properties: { 'orbitpm:nameAr': 'DMT HUB' } }])
  })

  it('rejects an en-target translation that contains Arabic codepoints', async () => {
    const { modeler, rec } = makeModeler({
      root: processRoot({ 'orbitpm:activeLang': 'ar' }),
      elements: [taskMissingEn('Task_B', 'طلب')]
    })
    const { callLLM } = makeCallLLM(['{"Task_B":"طلب Request"}'])

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 0, skipped: 1, total: 1 })
    expect(rec).toEqual([])
  })

  it('rejects non-string and empty response values', async () => {
    const { modeler, rec } = makeModeler({
      root: processRoot({ 'orbitpm:activeLang': 'en' }),
      elements: [taskMissingAr('Task_A', 'Order'), taskMissingAr('Task_B', 'Approve')]
    })
    const { callLLM } = makeCallLLM(['{"Task_A":42,"Task_B":"   "}'])

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 0, skipped: 2, total: 2 })
    expect(rec).toEqual([])
  })

  it('trims whitespace around applied translations', async () => {
    const el = taskMissingAr('Task_A', 'Order')
    const { modeler, rec } = makeModeler({
      root: processRoot({ 'orbitpm:activeLang': 'en' }),
      elements: [el]
    })
    const { callLLM } = makeCallLLM(['{"Task_A":"  طلب  "}'])

    await translateDiagram(modeler, callLLM)

    expect(rec).toEqual([{ element: el, properties: { 'orbitpm:nameAr': 'طلب' } }])
  })

  it('chunks by direction and size: chunkSize 2 over 2 en + 3 ar entries makes 3 single-direction calls', async () => {
    const en1 = taskMissingEn('En_1', 'طلب')
    const en2 = taskMissingEn('En_2', 'موافقة')
    const ar1 = taskMissingAr('Ar_1', 'Ship')
    const ar2 = taskMissingAr('Ar_2', 'Review')
    const ar3 = taskMissingAr('Ar_3', 'Archive')
    const { modeler, rec } = makeModeler({
      root: processRoot({ 'orbitpm:activeLang': 'en' }),
      // Interleaved registry order — grouping is by target, not adjacency.
      elements: [ar1, en1, ar2, en2, ar3]
    })
    const { callLLM, calls } = makeCallLLM([echoEn, echoAr, echoAr])

    const outcome = await translateDiagram(modeler, callLLM, { chunkSize: 2 })

    expect(outcome).toEqual({ translated: 5, skipped: 0, total: 5 })
    expect(calls).toHaveLength(3)
    // en group first (one chunk), then the ar group split 2 + 1.
    expect(calls[0].messages[0].content).toContain('request: English')
    expect(Object.keys(payloadOf(calls[0]))).toEqual(['En_1', 'En_2'])
    expect(calls[1].messages[0].content).toContain('request: Arabic')
    expect(Object.keys(payloadOf(calls[1]))).toEqual(['Ar_1', 'Ar_2'])
    expect(calls[2].messages[0].content).toContain('request: Arabic')
    expect(Object.keys(payloadOf(calls[2]))).toEqual(['Ar_3'])
    expect(rec).toHaveLength(5) // one write per element, none dropped
  })

  it('defaults to 60 entries per chunk', async () => {
    const elements = Array.from({ length: 61 }, (_, i) => taskMissingAr(`Task_${i}`, `Step ${i}`))
    const { modeler } = makeModeler({
      root: processRoot({ 'orbitpm:activeLang': 'en' }),
      elements
    })
    const { callLLM, calls } = makeCallLLM([echoAr, echoAr])

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 61, skipped: 0, total: 61 })
    expect(calls).toHaveLength(2)
    expect(Object.keys(payloadOf(calls[0]))).toHaveLength(60)
    expect(Object.keys(payloadOf(calls[1]))).toHaveLength(1)
  })

  it('never writes orbitpm:activeLang when it is already stored', async () => {
    const root = processRoot({ 'orbitpm:activeLang': 'ar' })
    const { modeler, rec } = makeModeler({ root, elements: [taskMissingEn('Task_B', 'طلب')] })
    const { callLLM } = makeCallLLM(['{"Task_B":"Request"}'])

    await translateDiagram(modeler, callLLM)

    expect(rec.some((r) => 'orbitpm:activeLang' in r.properties)).toBe(false)
    expect(root.businessObject?.$attrs?.['orbitpm:activeLang']).toBe('ar')
  })

  it('handles an empty diagram: no LLM calls, zero outcome, absent activeLang stamped with the default', async () => {
    const root = processRoot()
    const { modeler, rec } = makeModeler({ root, elements: [] })
    const { callLLM, calls } = makeCallLLM([]) // any call would throw

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 0, skipped: 0, total: 0 })
    expect(calls).toHaveLength(0)
    // No labels to detect from ⇒ 'en', the same default the toggle assumes for
    // an absent flag — stamping it is a no-op semantically, and mirrors the
    // toggle's own unconditional root write.
    expect(rec).toEqual([{ element: root, properties: { 'orbitpm:activeLang': 'en' } }])
  })

  it('writes through a wrapped element for a collaboration processRef (bag and stamp share the wrapper)', async () => {
    const processRef: FakeBusinessObject = {
      $type: 'bpmn:Process',
      id: 'Process_9',
      name: 'عملية رئيسية',
      $attrs: { 'orbitpm:nameAr': 'عملية رئيسية' }
    }
    const root: FakeElement = {
      id: 'Collab_1',
      businessObject: { $type: 'bpmn:Collaboration', participants: [{ processRef }] }
    }
    const { modeler, rec } = makeModeler({ root, elements: [] })
    const { callLLM } = makeCallLLM(['{"Process_9":"Main Process"}'])

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 1, skipped: 0, total: 1 })
    expect(rec).toHaveLength(2)
    // Never hand the bare business object to updateProperties (bpmn-js's
    // UpdatePropertiesHandler reads element.businessObject with no fallback):
    // both the translation write and the activeLang stamp go through the SAME
    // wrapper object.
    expect(rec[0].element).not.toBe(processRef)
    expect((rec[0].element as { businessObject?: unknown }).businessObject).toBe(processRef)
    expect(rec[1].element).toBe(rec[0].element)
    expect(rec[0].properties).toEqual({ 'orbitpm:nameEn': 'Main Process' })
    expect(rec[1].properties).toEqual({ 'orbitpm:activeLang': 'ar' }) // detected from the Arabic label
    expect(processRef.$attrs).toEqual({
      'orbitpm:nameAr': 'عملية رئيسية',
      'orbitpm:nameEn': 'Main Process',
      'orbitpm:activeLang': 'ar'
    })
  })

  it('accepts an already-parsed object response (CallLLM may return non-string values)', async () => {
    const el = taskMissingAr('Task_A', 'Order')
    const { modeler, rec } = makeModeler({
      root: processRoot({ 'orbitpm:activeLang': 'en' }),
      elements: [el]
    })
    const { callLLM, calls } = makeCallLLM([{ Task_A: 'طلب' }])

    const outcome = await translateDiagram(modeler, callLLM)

    expect(outcome).toEqual({ translated: 1, skipped: 0, total: 1 })
    expect(calls).toHaveLength(1)
    expect(rec).toEqual([{ element: el, properties: { 'orbitpm:nameAr': 'طلب' } }])
  })

  it('propagates a rejected callLLM (transport failures are not swallowed into skips)', async () => {
    const { modeler, rec } = makeModeler({
      root: processRoot({ 'orbitpm:activeLang': 'en' }),
      elements: [taskMissingAr('Task_A', 'Order')]
    })
    const callLLM: CallLLM = async () => {
      throw new Error('anthropic 401: invalid api key')
    }

    await expect(translateDiagram(modeler, callLLM)).rejects.toThrow('401')
    expect(rec).toEqual([]) // nothing half-applied
  })

  it('matches collectMissingTranslations: total equals the collected entry count', async () => {
    const root = processRoot({ 'orbitpm:activeLang': 'en' })
    const elements = [
      taskMissingAr('Task_A', 'Order'),
      taskMissingEn('Task_B', 'طلب'),
      { id: 'Task_D', businessObject: { $type: 'bpmn:Task', name: 'Plain' } } as FakeElement
    ]
    const { modeler } = makeModeler({ root, elements })
    const collected = collectMissingTranslations(modeler)
    const { callLLM } = makeCallLLM([echoEn, echoAr])

    const outcome = await translateDiagram(modeler, callLLM)

    expect(collected).toHaveLength(3)
    expect(outcome.total).toBe(3)
    expect(outcome.translated + outcome.skipped).toBe(outcome.total)
  })
})
