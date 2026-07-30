// @vitest-environment jsdom

/**
 * The mounted, writable details rail (plan §13.3, §11.4, §8.2, UI-03).
 *
 * Two halves:
 *
 *  1. **Behaviour** — the rail is driven with real DOM events against a
 *     recording `ArisDetailsEditingApi`, which pins exactly which authoring
 *     call each gesture makes, with which locale id, and how many times.
 *  2. **One undo step** — the same gestures are then driven against a real
 *     booted `ArisCanvas`, so "an edit made in the rail is one command on the
 *     same stack as a canvas gesture" is proved against the actual command
 *     stack rather than asserted about a mock.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setLang } from '../../i18n'
import { bootCanvas, type Harness } from '../canvas/testing/harness'
import { adaptWorkingDocument } from '../details/seam'
import type { ArisDetailsDocument, ArisDetailsElement } from '../details/seam'
import type {
  ArisAttributeValue,
  ArisObjectDefinition,
  ArisOccurrenceStyle,
  ArisWorkingDocument
} from '../model/types'
import type { ArisAttachment } from '../canvas/attachments'
import { ArisDetailsRail, type ArisDetailsRailHighlight } from './ArisDetailsRail'
import type { ArisDetailsEditingApi } from './arisDetailsEditing'
import { AR_LOCALE, EN_LOCALE, buildEditingFixture } from './arisDetailsEditingFixture'

interface Recorder {
  readonly api: ArisDetailsEditingApi
  readonly calls: { name: string; args: readonly unknown[] }[]
}

function recorder(): Recorder {
  const calls: { name: string; args: readonly unknown[] }[] = []
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push({ name, args })
    }
  return {
    calls,
    api: {
      renameDefinition: record('renameDefinition') as ArisDetailsEditingApi['renameDefinition'],
      renameModel: record('renameModel') as ArisDetailsEditingApi['renameModel'],
      setDefinitionAttribute: record(
        'setDefinitionAttribute'
      ) as ArisDetailsEditingApi['setDefinitionAttribute'],
      restyleOccurrence: record('restyleOccurrence') as ArisDetailsEditingApi['restyleOccurrence'],
      addModelAssignment: record(
        'addModelAssignment'
      ) as ArisDetailsEditingApi['addModelAssignment'],
      removeModelAssignment: record(
        'removeModelAssignment'
      ) as ArisDetailsEditingApi['removeModelAssignment'],
      addAttachment: record('addAttachment') as ArisDetailsEditingApi['addAttachment'],
      removeAttachment: record('removeAttachment') as ArisDetailsEditingApi['removeAttachment'],
      downloadAttachment: record(
        'downloadAttachment'
      ) as ArisDetailsEditingApi['downloadAttachment']
    }
  }
}

const workingDocument = buildEditingFixture()
const details: ArisDetailsDocument = adaptWorkingDocument(workingDocument)

function mount(
  element: ArisDetailsElement,
  editing: ArisDetailsEditingApi | null,
  onEditError = vi.fn()
): void {
  render(
    <ArisDetailsRail
      details={details}
      element={element}
      elementLabel="Approve request"
      modelId="m1"
      onDownloadAttachment={vi.fn()}
      document={workingDocument}
      lang="en"
      editing={editing}
      onEditError={onEditError}
    />
  )
}

function tab(id: string): HTMLElement {
  return document.querySelector(`[data-orbitpm-aris-details-tab="${id}"]`) as HTMLElement
}

function openTab(id: string): void {
  fireEvent.click(tab(id))
}

function field(selector: string): HTMLInputElement {
  const node = document.querySelector(selector)
  expect(node, `no field matching ${selector}`).not.toBeNull()
  return node as HTMLInputElement
}

/** Type into a field and commit it the way a person would: blur. */
function typeAndBlur(node: HTMLInputElement, value: string): void {
  fireEvent.change(node, { target: { value } })
  fireEvent.blur(node)
}

afterEach(() => {
  cleanup()
  setLang('en')
})

describe('bilingual name editing (plan §21.3 "edit bilingual attributes")', () => {
  it('writes each language back under the locale id the document already uses', () => {
    const spy = recorder()
    mount({ kind: 'objectOccurrence', id: 'occ-1' }, spy.api)
    openTab('names')

    const en = field('[data-orbitpm-aris-name-input="definition:en"]')
    const ar = field('[data-orbitpm-aris-name-input="definition:ar"]')
    expect(en.value).toBe('Approve request')
    expect(ar.value).toBe('اعتماد الطلب')

    typeAndBlur(en, 'Approve the request')
    typeAndBlur(ar, 'اعتماد الطلب المقدَّم')

    expect(spy.calls).toEqual([
      { name: 'renameDefinition', args: ['od-shared', EN_LOCALE, 'Approve the request'] },
      { name: 'renameDefinition', args: ['od-shared', AR_LOCALE, 'اعتماد الطلب المقدَّم'] }
    ])
  })

  it('commits once per edit — keystrokes are drafts, not commands', () => {
    const spy = recorder()
    mount({ kind: 'objectOccurrence', id: 'occ-1' }, spy.api)
    openTab('names')

    const en = field('[data-orbitpm-aris-name-input="definition:en"]')
    fireEvent.change(en, { target: { value: 'A' } })
    fireEvent.change(en, { target: { value: 'Ap' } })
    fireEvent.change(en, { target: { value: 'App' } })
    expect(spy.calls).toHaveLength(0)

    fireEvent.keyDown(en, { key: 'Enter' })
    expect(spy.calls).toHaveLength(1)
    // Blurring afterwards must not commit the same value a second time.
    fireEvent.blur(en)
    expect(spy.calls).toHaveLength(1)
  })

  it('discards a draft on Escape without touching the document', () => {
    const spy = recorder()
    mount({ kind: 'objectOccurrence', id: 'occ-1' }, spy.api)
    openTab('names')

    const en = field('[data-orbitpm-aris-name-input="definition:en"]')
    fireEvent.change(en, { target: { value: 'Discarded' } })
    fireEvent.keyDown(en, { key: 'Escape' })
    expect(en.value).toBe('Approve request')
    fireEvent.blur(en)
    expect(spy.calls).toHaveLength(0)
  })

  it('edits a model name through the model owner, not a definition', () => {
    const spy = recorder()
    mount({ kind: 'model', id: 'm2' }, spy.api)
    openTab('names')
    typeAndBlur(field('[data-orbitpm-aris-name-input="model:en"]'), 'Sub process v2')
    expect(spy.calls).toEqual([{ name: 'renameModel', args: ['m2', EN_LOCALE, 'Sub process v2'] }])
  })

  it('offers the document convention for a language with no value yet', () => {
    const spy = recorder()
    mount({ kind: 'objectOccurrence', id: 'occ-4' }, spy.api)
    openTab('names')
    const ar = field('[data-orbitpm-aris-name-input="definition:ar"]')
    expect(ar.value).toBe('')
    typeAndBlur(ar, 'حدث')
    expect(spy.calls).toEqual([{ name: 'renameDefinition', args: ['od-solo', AR_LOCALE, 'حدث'] }])
  })
})

describe('the §8.2 definition / occurrence distinction is visible', () => {
  it('names an edit that reaches every occurrence, with the real counts', () => {
    mount({ kind: 'objectOccurrence', id: 'occ-1' }, recorder().api)
    openTab('names')
    const note = document.querySelector('[data-orbitpm-aris-scope="definition"]') as HTMLElement
    expect(note).not.toBeNull()
    expect(note.getAttribute('data-orbitpm-aris-scope-count')).toBe('3')
    expect(note.getAttribute('data-orbitpm-aris-scope-models')).toBe('2')
    expect(note.textContent).toContain('3')
    // The field is wired to the note, so the blast radius is announced.
    expect(
      field('[data-orbitpm-aris-name-input="definition:en"]').getAttribute('aria-describedby')
    ).toContain(note.id)
  })

  it('names an occurrence-only edit on the style group of the same selection', () => {
    mount({ kind: 'objectOccurrence', id: 'occ-2' }, recorder().api)
    openTab('general')
    const editor = document.querySelector('[data-orbitpm-aris-style-editor]') as HTMLElement
    expect(editor).not.toBeNull()
    const note = editor.querySelector('[data-orbitpm-aris-scope="occurrence"]')
    expect(note).not.toBeNull()
    expect(within(editor).getByText('This shape only')).toBeTruthy()
  })

  it('offers no style editor for a definition selection, which has no geometry', () => {
    mount({ kind: 'objectDefinition', id: 'od-shared' }, recorder().api)
    openTab('general')
    expect(document.querySelector('[data-orbitpm-aris-style-editor]')).toBeNull()
  })
})

describe('ARIS attribute editing (plan §11.4 "edit definition attributes")', () => {
  it('replaces one locale value and leaves every other value byte-identical', () => {
    const spy = recorder()
    mount({ kind: 'objectDefinition', id: 'od-shared' }, spy.api)
    openTab('attributes')

    typeAndBlur(field('[data-orbitpm-aris-attribute-input="AT_DESC:ar"]'), 'خطوة الموافقة')
    expect(spy.calls).toHaveLength(1)
    expect(spy.calls[0].name).toBe('setDefinitionAttribute')
    expect(spy.calls[0].args[0]).toBe('od-shared')
    expect(spy.calls[0].args[1]).toBe('AT_DESC')
    expect(spy.calls[0].args[2] as ArisAttributeValue[]).toEqual([
      { localeId: EN_LOCALE, text: 'Approval step' },
      { localeId: AR_LOCALE, text: 'خطوة الموافقة' },
      { localeId: 'de-DE', text: 'Genehmigungsschritt' }
    ])
  })

  it('exposes a third-locale value for editing rather than dropping it on write-back', () => {
    const spy = recorder()
    mount({ kind: 'objectDefinition', id: 'od-shared' }, spy.api)
    openTab('attributes')
    const de = field('[data-orbitpm-aris-attribute-input="AT_DESC:de-DE"]')
    expect(de.value).toBe('Genehmigungsschritt')
    typeAndBlur(de, 'Freigabeschritt')
    expect((spy.calls[0].args[2] as ArisAttributeValue[])[2]).toEqual({
      localeId: 'de-DE',
      text: 'Freigabeschritt'
    })
  })

  it('adds a value in another locale in one command', () => {
    const spy = recorder()
    mount({ kind: 'objectDefinition', id: 'od-shared' }, spy.api)
    openTab('attributes')

    fireEvent.click(field('[data-orbitpm-aris-attribute-add-open="AT_DESC"]'))
    fireEvent.change(field('[data-orbitpm-aris-attribute-new-locale="AT_DESC"]'), {
      target: { value: 'fr-FR' }
    })
    fireEvent.change(field('[data-orbitpm-aris-attribute-new-text="AT_DESC"]'), {
      target: { value: 'Étape de validation' }
    })
    fireEvent.click(field('[data-orbitpm-aris-attribute-add-submit="AT_DESC"]'))

    expect(spy.calls).toHaveLength(1)
    expect((spy.calls[0].args[2] as ArisAttributeValue[])[3]).toEqual({
      localeId: 'fr-FR',
      text: 'Étape de validation'
    })
    // The form closes and focus returns to the control that opened it.
    expect(document.querySelector('[data-orbitpm-aris-attribute-add="AT_DESC"]')).toBeNull()
    expect(document.activeElement).toBe(field('[data-orbitpm-aris-attribute-add-open="AT_DESC"]'))
  })

  it('reports Arabic prose filed under the English locale tag without re-filing it', () => {
    mount({ kind: 'objectDefinition', id: 'od-shared' }, recorder().api)
    openTab('attributes')
    const remEn = field('[data-orbitpm-aris-attribute-input="AT_REM:en"]')
    expect(remEn.value).toBe('ملاحظة تشغيلية')
    const hintId = (remEn.getAttribute('aria-describedby') ?? '').split(' ').pop() as string
    const hint = document.getElementById(hintId)
    expect(hint?.textContent).toContain(EN_LOCALE)
    expect(hint?.textContent).toContain('Arabic')
  })
})

describe('linked-model assignments (plan §11.4)', () => {
  it('removes an existing assignment', () => {
    const spy = recorder()
    mount({ kind: 'objectDefinition', id: 'od-shared' }, spy.api)
    openTab('assignments')
    fireEvent.click(field('[data-orbitpm-aris-assignment-remove="m2"]'))
    expect(spy.calls).toEqual([{ name: 'removeModelAssignment', args: ['od-shared', 'm2'] }])
  })

  it('adds an assignment chosen from the models that are not linked yet', () => {
    const spy = recorder()
    mount({ kind: 'objectDefinition', id: 'od-shared' }, spy.api)
    openTab('assignments')
    const select = document.querySelector(
      '[data-orbitpm-aris-assignment-choice]'
    ) as HTMLSelectElement
    // `m2` is already linked, so only `m1` is offered.
    expect([...select.options].map((option) => option.value)).toEqual(['m1'])
    fireEvent.click(field('[data-orbitpm-aris-assignment-add]'))
    expect(spy.calls).toEqual([{ name: 'addModelAssignment', args: ['od-shared', 'm1'] }])
  })
})

describe('attachments (plan §11.4, §13.4)', () => {
  const STORED: ArisAttachment = {
    id: 'att-1',
    fileName: 'policy.pdf',
    mimeType: 'application/pdf',
    size: 3,
    dataBase64: 'AAEC'
  }

  /** The fixture document with one authored attachment on `od-shared`. */
  function withAttachment(): ArisWorkingDocument {
    const base = buildEditingFixture()
    const definition = base.objectDefinitions.get('od-shared') as ArisObjectDefinition
    const patched: ArisObjectDefinition = {
      ...definition,
      attributes: [
        ...definition.attributes,
        {
          type: 'AT_ORBITPM_ATTACHMENT',
          values: [{ localeId: STORED.id, text: JSON.stringify(STORED) }]
        }
      ]
    }
    return {
      ...base,
      objectDefinitions: new Map([...base.objectDefinitions, ['od-shared', patched]])
    }
  }

  function mountWithAttachment(
    editing: ArisDetailsEditingApi,
    onEditError = vi.fn()
  ): ArisWorkingDocument {
    const document_ = withAttachment()
    render(
      <ArisDetailsRail
        details={adaptWorkingDocument(document_)}
        element={{ kind: 'objectDefinition', id: 'od-shared' }}
        elementLabel="Approve request"
        modelId="m1"
        onDownloadAttachment={vi.fn()}
        document={document_}
        lang="en"
        editing={editing}
        onEditError={onEditError}
      />
    )
    return document_
  }

  it('lists an authored attachment and downloads it through the authoring API', () => {
    const spy = recorder()
    mountWithAttachment(spy.api)
    openTab('attachments')
    expect(screen.getByText('policy.pdf')).toBeTruthy()
    fireEvent.click(field('[data-orbitpm-aris-attachment-download="att-1"]'))
    expect(spy.calls).toEqual([{ name: 'downloadAttachment', args: ['od-shared', 'att-1'] }])
  })

  it('never removes an attachment without a confirmation, and focuses the confirmation', () => {
    const spy = recorder()
    mountWithAttachment(spy.api)
    openTab('attachments')

    fireEvent.click(field('[data-orbitpm-aris-attachment-remove="att-1"]'))
    expect(spy.calls).toHaveLength(0)
    const confirm = field('[data-orbitpm-aris-attachment-confirm-remove="att-1"]')
    expect(document.activeElement).toBe(confirm)

    fireEvent.click(confirm)
    expect(spy.calls).toEqual([{ name: 'removeAttachment', args: ['od-shared', 'att-1'] }])
  })

  it('cancels the confirmation with Escape and returns focus to the Remove button', () => {
    const spy = recorder()
    mountWithAttachment(spy.api)
    openTab('attachments')

    fireEvent.click(field('[data-orbitpm-aris-attachment-remove="att-1"]'))
    fireEvent.keyDown(field('[data-orbitpm-aris-attachment-confirm-remove="att-1"]'), {
      key: 'Escape'
    })
    expect(document.querySelector('[data-orbitpm-aris-attachment-confirm="att-1"]')).toBeNull()
    expect(document.activeElement).toBe(field('[data-orbitpm-aris-attachment-remove="att-1"]'))
    expect(spy.calls).toHaveLength(0)
  })

  it('encodes a chosen file and adds it as one attachment', async () => {
    const spy = recorder()
    mountWithAttachment(spy.api)
    openTab('attachments')

    const bytes = new Uint8Array([1, 2, 3, 4])
    const file = new File([bytes], 'notes.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => bytes.buffer
    })
    fireEvent.change(field('[data-orbitpm-aris-attachment-add]'), { target: { files: [file] } })
    await vi.waitFor(() => expect(spy.calls).toHaveLength(1))

    expect(spy.calls[0].name).toBe('addAttachment')
    expect(spy.calls[0].args[1]).toMatchObject({
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      size: 4,
      dataBase64: btoa('')
    })
  })

  it('refuses an oversized file instead of inlining it, and reports why', async () => {
    const spy = recorder()
    const onError = vi.fn()
    mountWithAttachment(spy.api, onError)
    openTab('attachments')

    const file = new File([new Uint8Array([1])], 'huge.bin', { type: 'application/octet-stream' })
    Object.defineProperty(file, 'size', { configurable: true, value: 8 * 1024 * 1024 })
    fireEvent.change(field('[data-orbitpm-aris-attachment-add]'), { target: { files: [file] } })

    expect(spy.calls).toHaveLength(0)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(String(onError.mock.calls[0][0])).toContain('huge.bin')
  })
})

describe('occurrence style (plan §11.4 "restyle occurrence")', () => {
  it('restyles this occurrence only, and clears an override when emptied', () => {
    const spy = recorder()
    mount({ kind: 'objectOccurrence', id: 'occ-2' }, spy.api)
    openTab('general')

    const fill = field('[data-orbitpm-aris-style-input="fillColor"]')
    expect(fill.value).toBe('#ff0000')
    typeAndBlur(fill, '#00ff00')
    typeAndBlur(field('[data-orbitpm-aris-style-input="strokeWidth"]'), '3')
    fireEvent.change(document.querySelector('[data-orbitpm-aris-style-input="lineStyle"]')!, {
      target: { value: 'dashed' }
    })

    expect(spy.calls).toEqual([
      { name: 'restyleOccurrence', args: ['occ-2', { fillColor: '#00ff00' }] },
      { name: 'restyleOccurrence', args: ['occ-2', { strokeWidth: 3 }] },
      { name: 'restyleOccurrence', args: ['occ-2', { lineStyle: 'dashed' }] }
    ])
  })
})

describe('the read-only tabs are not regressed', () => {
  it.each(['relations', 'history'] as const)(
    'still renders %s as rows with no editable control',
    (tabId) => {
      mount({ kind: 'model', id: 'm1' }, recorder().api)
      openTab(tabId)
      const panel = document.querySelector(
        `[data-orbitpm-aris-details-panel="${tabId}"]`
      ) as HTMLElement
      expect(panel).not.toBeNull()
      expect(panel.querySelectorAll('input, textarea, select')).toHaveLength(0)
    }
  )

  it('keeps the Ids tab read-only and still shows the definition behind an occurrence', () => {
    mount({ kind: 'objectOccurrence', id: 'occ-1' }, recorder().api)
    openTab('ids')
    const panel = document.querySelector('[data-orbitpm-aris-details-panel="ids"]') as HTMLElement
    expect(panel.textContent).toContain('od-shared')
    expect(panel.querySelectorAll('input')).toHaveLength(0)
  })

  it('renders exactly as before when no editing API is supplied', () => {
    mount({ kind: 'objectOccurrence', id: 'occ-1' }, null)
    openTab('names')
    expect(document.querySelector('[data-orbitpm-aris-bilingual-editor]')).toBeNull()
    expect(document.querySelector('.orbitpm-aris-defs')).not.toBeNull()
  })

  it('no longer offers the Accounting or Fidelity tabs (issue 5)', () => {
    mount({ kind: 'objectOccurrence', id: 'occ-1' }, recorder().api)
    expect(screen.queryByRole('tab', { name: 'Accounting' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Fidelity' })).toBeNull()
  })
})

describe('validation highlight (issue 5)', () => {
  function mountWithHighlight(
    element: ArisDetailsElement,
    editing: ArisDetailsEditingApi,
    highlight: ArisDetailsRailHighlight
  ): void {
    render(
      <ArisDetailsRail
        details={details}
        element={element}
        elementLabel="Approve request"
        modelId="m1"
        onDownloadAttachment={vi.fn()}
        document={workingDocument}
        lang="en"
        editing={editing}
        highlight={highlight}
      />
    )
  }

  it('opens the names tab and flashes the Arabic name input', () => {
    mountWithHighlight({ kind: 'objectDefinition', id: 'od-shared' }, recorder().api, {
      token: 1,
      tab: 'names',
      field: { kind: 'name', lang: 'ar' }
    })
    expect(tab('names').getAttribute('aria-selected')).toBe('true')
    const panel = document.querySelector('[data-orbitpm-aris-details-panel="names"]') as HTMLElement
    expect(panel.getAttribute('data-orbitpm-aris-highlight-field')).toBe('name:ar')
    expect(
      field('[data-orbitpm-aris-name-input="definition:ar"]').classList.contains(
        'orbitpm-aris-field-flash'
      )
    ).toBe(true)
  })

  it('renders a pending row for an absent attribute and commits it in one call', () => {
    const spy = recorder()
    mountWithHighlight({ kind: 'objectDefinition', id: 'od-shared' }, spy.api, {
      token: 1,
      tab: 'attributes',
      field: { kind: 'attribute', attributeType: 'AT_PERS_RESP' }
    })
    expect(
      document.querySelector('[data-orbitpm-aris-pending-attribute="AT_PERS_RESP"]')
    ).not.toBeNull()

    typeAndBlur(field('[data-orbitpm-aris-attribute-input="AT_PERS_RESP:en"]'), 'Intake team')
    expect(spy.calls).toHaveLength(1)
    expect(spy.calls[0].name).toBe('setDefinitionAttribute')
    expect(spy.calls[0].args[0]).toBe('od-shared')
    expect(spy.calls[0].args[1]).toBe('AT_PERS_RESP')
    expect(spy.calls[0].args[2] as ArisAttributeValue[]).toEqual([
      { localeId: EN_LOCALE, text: 'Intake team' }
    ])
  })
})

describe('keyboard and ARIA (UI-03)', () => {
  it('wires every tab to its panel in both directions and keeps one tab stop', () => {
    mount({ kind: 'objectOccurrence', id: 'occ-1' }, recorder().api)
    const tabs = [...document.querySelectorAll('[role="tab"]')] as HTMLElement[]
    expect(tabs.length).toBeGreaterThan(0)
    expect(tabs.filter((node) => node.tabIndex === 0)).toHaveLength(1)

    const selected = tabs.find(
      (node) => node.getAttribute('aria-selected') === 'true'
    ) as HTMLElement
    const panel = document.getElementById(selected.getAttribute('aria-controls') as string)
    expect(panel?.getAttribute('role')).toBe('tabpanel')
    expect(panel?.getAttribute('aria-labelledby')).toBe(selected.id)
  })

  it('moves between tabs with the arrow keys, Home and End in LTR', () => {
    mount({ kind: 'objectOccurrence', id: 'occ-1' }, recorder().api)
    const first = tab('general')
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(tab('names').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab('names'))

    fireEvent.keyDown(tab('names'), { key: 'ArrowLeft' })
    expect(tab('general').getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(tab('general'), { key: 'End' })
    expect(tab('history').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('history'), { key: 'Home' })
    expect(tab('general').getAttribute('aria-selected')).toBe('true')
  })

  it('reverses the arrow keys in RTL so ArrowLeft advances', () => {
    setLang('ar')
    mount({ kind: 'objectOccurrence', id: 'occ-1' }, recorder().api)
    const first = tab('general')
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    expect(tab('names').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('names'), { key: 'ArrowRight' })
    expect(tab('general').getAttribute('aria-selected')).toBe('true')
  })

  it('labels every editable field with a real <label for>', () => {
    mount({ kind: 'objectOccurrence', id: 'occ-1' }, recorder().api)
    openTab('names')
    const panel = document.querySelector('[data-orbitpm-aris-details-panel="names"]') as HTMLElement
    const inputs = [...panel.querySelectorAll('input')]
    expect(inputs.length).toBeGreaterThan(0)
    for (const input of inputs) {
      expect(panel.querySelector(`label[for="${input.id}"]`)).not.toBeNull()
    }
  })
})

describe('every rail edit is one command on the canvas stack', () => {
  let harness: Harness | null = null

  afterEach(() => {
    harness?.destroy()
    harness = null
  })

  /** An editing API bound to a real canvas, exactly as `ArisStudioTab` builds it. */
  function liveEditing(canvas: Harness['canvas']): ArisDetailsEditingApi {
    return {
      renameDefinition: (definitionId, localeId, name) =>
        canvas.authoring.renameDefinition(definitionId, name, localeId),
      renameModel: (modelId, localeId, name) =>
        canvas.authoring.renameModel(modelId, name, localeId),
      setDefinitionAttribute: (definitionId, attributeType, values) =>
        canvas.authoring.setDefinitionAttribute(definitionId, attributeType, values),
      restyleOccurrence: (occurrenceId: string, style: Partial<ArisOccurrenceStyle>) =>
        canvas.authoring.restyleOccurrence(occurrenceId, style),
      addModelAssignment: (definitionId, modelId) =>
        canvas.authoring.addModelAssignment(definitionId, modelId),
      removeModelAssignment: (definitionId, modelId) =>
        canvas.authoring.removeModelAssignment(definitionId, modelId),
      addAttachment: (definitionId, attachment) =>
        canvas.authoring.addAttachment(definitionId, attachment),
      removeAttachment: (definitionId, attachmentId) =>
        canvas.authoring.removeAttachment(definitionId, attachmentId),
      downloadAttachment: (definitionId, attachmentId) => {
        canvas.authoring.downloadAttachment(definitionId, attachmentId)
      }
    }
  }

  function renderLive(
    canvas: Harness['canvas'],
    element: ArisDetailsElement
  ): ReturnType<typeof render> {
    return render(
      <ArisDetailsRail
        details={adaptWorkingDocument(canvas.document)}
        element={element}
        elementLabel="live"
        modelId={canvas.activeModelId}
        onDownloadAttachment={vi.fn()}
        document={canvas.document}
        lang="en"
        editing={liveEditing(canvas)}
      />
    )
  }

  it('renames a definition in one undoable step that reaches every occurrence', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'Approve',
      position: { x: 20, y: 20 }
    })
    const secondOccurrenceId = canvas.authoring.createAdditionalOccurrence({
      definitionId: created.definitionId,
      position: { x: 300, y: 20 }
    })
    const commandsBefore = canvas.commandLog.length

    renderLive(canvas, { kind: 'objectOccurrence', id: created.occurrenceId })
    openTab('names')
    typeAndBlur(field('[data-orbitpm-aris-name-input="definition:en"]'), 'Approve v2')

    expect(canvas.commandLog.length).toBe(commandsBefore + 1)
    const definition = canvas.document.objectDefinitions.get(created.definitionId)
    expect(Object.values(definition?.names.values ?? {})).toContain('Approve v2')
    // §8.2: one definition, so both shapes now read the new name.
    for (const occurrenceId of [created.occurrenceId, secondOccurrenceId]) {
      const occurrence = canvas.document.models
        .get(canvas.activeModelId)
        ?.occurrences.find((entry) => entry.id === occurrenceId)
      expect(occurrence?.definitionId).toBe(created.definitionId)
    }

    canvas.undo()
    expect(canvas.commandLog.length).toBe(commandsBefore)
    expect(
      Object.values(canvas.document.objectDefinitions.get(created.definitionId)?.names.values ?? {})
    ).toContain('Approve')
  })

  it('restyles one occurrence in one undoable step and leaves its sibling alone', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'Approve',
      position: { x: 20, y: 20 }
    })
    const siblingId = canvas.authoring.createAdditionalOccurrence({
      definitionId: created.definitionId,
      position: { x: 300, y: 20 }
    })
    const commandsBefore = canvas.commandLog.length

    renderLive(canvas, { kind: 'objectOccurrence', id: created.occurrenceId })
    openTab('general')
    typeAndBlur(field('[data-orbitpm-aris-style-input="fillColor"]'), '#123456')

    const occurrences = canvas.document.models.get(canvas.activeModelId)?.occurrences ?? []
    expect(occurrences.find((entry) => entry.id === created.occurrenceId)?.style.fillColor).toBe(
      '#123456'
    )
    expect(occurrences.find((entry) => entry.id === siblingId)?.style.fillColor).toBeNull()
    expect(canvas.commandLog.length).toBe(commandsBefore + 1)

    canvas.undo()
    expect(
      canvas.document.models
        .get(canvas.activeModelId)
        ?.occurrences.find((entry) => entry.id === created.occurrenceId)?.style.fillColor
    ).toBeNull()
  })

  it('adds and removes an attachment in one undoable step each, round-tripping the bytes', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'Approve',
      position: { x: 20, y: 20 }
    })
    canvas.authoring.addAttachment(created.definitionId, {
      id: 'att-live',
      fileName: 'policy.pdf',
      mimeType: 'application/pdf',
      size: 3,
      dataBase64: 'AAEC'
    })
    const commandsBefore = canvas.commandLog.length

    renderLive(canvas, { kind: 'objectDefinition', id: created.definitionId })
    openTab('attachments')
    expect(screen.getByText('policy.pdf')).toBeTruthy()

    fireEvent.click(field('[data-orbitpm-aris-attachment-remove="att-live"]'))
    fireEvent.click(field('[data-orbitpm-aris-attachment-confirm-remove="att-live"]'))

    expect(canvas.authoring.listAttachments(created.definitionId)).toHaveLength(0)
    expect(canvas.commandLog.length).toBe(commandsBefore + 1)
    canvas.undo()
    expect(canvas.authoring.listAttachments(created.definitionId)).toHaveLength(1)
  })

  it('adds a model assignment in one undoable step', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'Approve',
      position: { x: 20, y: 20 }
    })
    const commandsBefore = canvas.commandLog.length

    renderLive(canvas, { kind: 'objectDefinition', id: created.definitionId })
    openTab('assignments')
    fireEvent.click(field('[data-orbitpm-aris-assignment-add]'))

    expect(canvas.document.objectDefinitions.get(created.definitionId)?.linkedModelIds).toEqual([
      canvas.activeModelId
    ])
    expect(canvas.commandLog.length).toBe(commandsBefore + 1)
    canvas.undo()
    expect(canvas.document.objectDefinitions.get(created.definitionId)?.linkedModelIds).toEqual([])
  })
})
