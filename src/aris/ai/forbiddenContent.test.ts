import { describe, expect, it } from 'vitest'
import { scanForForbiddenContent } from './forbiddenContent'
import { buildMinimalValidDraft } from './testFixtures'
import { validateArisAiDraft } from './validateDraft'

function withObjectPatch(overrides: Record<string, unknown>): unknown {
  const draft = buildMinimalValidDraft()
  return {
    ...draft,
    objects: draft.objects.map((object) =>
      object.logicalId === 'func-approve' ? { ...object, ...overrides } : object
    )
  }
}

describe('scanForForbiddenContent', () => {
  it('finds nothing in a clean minimal draft', () => {
    expect(scanForForbiddenContent(buildMinimalValidDraft())).toEqual([])
  })

  // --- XML/AML markup ------------------------------------------------------

  it('rejects XML injection through a model name', () => {
    const draft = buildMinimalValidDraft()
    const attacked = {
      ...draft,
      models: draft.models.map((model) =>
        model.logicalId === 'model-main'
          ? { ...model, names: { en: '<Model Model.ID="fake"><Inject/></Model>' } }
          : model
      )
    }
    const result = validateArisAiDraft(attacked)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.some((f) => f.code === 'forbidden-xml-markup')).toBe(true)
    }
  })

  it('rejects XML injection through an object name', () => {
    const attacked = withObjectPatch({ names: { en: '<ObjDef ObjDef.ID="x">Approve</ObjDef>' } })
    const result = validateArisAiDraft(attacked)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.some((f) => f.code === 'forbidden-xml-markup')).toBe(true)
    }
  })

  it('rejects XML injection through an attribute value', () => {
    const draft = buildMinimalValidDraft()
    const attacked = withObjectPatch({
      attributes: draft.objects
        .find((o) => o.logicalId === 'func-approve')!
        .attributes.map((attribute) => ({
          ...attribute,
          values: { en: 'Fine <AttrValue LocaleId="en-US">injected</AttrValue>' }
        }))
    })
    const result = validateArisAiDraft(attacked)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.some((f) => f.code === 'forbidden-xml-markup')).toBe(true)
    }
  })

  it('rejects XML injection through an evidence field', () => {
    const attacked = withObjectPatch({ evidence: 'See <ObjOcc ObjOcc.ID="x"/> in the source.' })
    const result = validateArisAiDraft(attacked)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.some((f) => f.code === 'forbidden-xml-markup')).toBe(true)
    }
  })

  it('rejects the XML prolog, DOCTYPE, and CDATA sections', () => {
    for (const payload of ['<?xml version="1.0"?>', '<!DOCTYPE AML>', '<![CDATA[hi]]>']) {
      const attacked = withObjectPatch({ evidence: payload })
      const result = validateArisAiDraft(attacked)
      expect(result.ok).toBe(false)
    }
  })

  // --- real ARIS ids ---------------------------------------------------------

  it('rejects a value shaped like a real ARIS object-definition id', () => {
    const attacked = withObjectPatch({
      evidence: 'Derived from ObjDef.-10mm1DorpTb-p-L in the export.'
    })
    const result = validateArisAiDraft(attacked)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.some((f) => f.code === 'forbidden-real-id')).toBe(true)
    }
  })

  it('rejects a value shaped like a real ARIS connection-definition id used as a logical id', () => {
    const draft = buildMinimalValidDraft()
    const attacked = {
      ...draft,
      relations: draft.relations.map((relation) =>
        relation.logicalId === 'rel-start-to-approve'
          ? { ...relation, logicalId: 'CxnDef.10i8WPnmE-z-q-L' }
          : relation
      )
    }
    const result = validateArisAiDraft(attacked)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.some((f) => f.code === 'forbidden-real-id')).toBe(true)
    }
  })

  it('does not flag a plausible human-chosen logical id as a real ARIS id', () => {
    expect(scanForForbiddenContent('func-approve-request-1')).toEqual([])
    expect(scanForForbiddenContent('model-main')).toEqual([])
  })

  // --- executable content -----------------------------------------------------

  it('rejects a javascript: URL in a name field', () => {
    const attacked = withObjectPatch({ names: { en: 'javascript:alert(document.cookie)' } })
    const result = validateArisAiDraft(attacked)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.some((f) => f.code === 'forbidden-executable-content')).toBe(true)
    }
  })

  it('rejects an inline <script> tag', () => {
    const attacked = withObjectPatch({ evidence: '<script>fetch("https://evil.example")</script>' })
    const result = validateArisAiDraft(attacked)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.some((f) => f.code === 'forbidden-executable-content')).toBe(true)
    }
  })

  it('rejects an event-handler attribute payload', () => {
    const attacked = withObjectPatch({ evidence: '<img src=x onerror="alert(1)">' })
    const result = validateArisAiDraft(attacked)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.some((f) => f.code === 'forbidden-executable-content')).toBe(true)
    }
  })

  // --- coordinates/geometry ----------------------------------------------------

  it('rejects a geometry field nested arbitrarily deep in the draft', () => {
    const findings = scanForForbiddenContent({
      objects: [
        { names: { en: 'ok' }, attributes: [{ values: { en: 'ok' }, bounds: { x: 10, y: 20 } }] }
      ]
    })
    expect(findings.some((f) => f.code === 'forbidden-geometry-field')).toBe(true)
  })

  it('rejects coordinate keys smuggled into an otherwise-valid draft', () => {
    const draft = buildMinimalValidDraft()
    const attacked = {
      ...draft,
      objects: draft.objects.map((object) =>
        object.logicalId === 'func-approve' ? { ...object, position: { x: 10, y: 20 } } : object
      )
    }
    const result = validateArisAiDraft(attacked)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.some((f) => f.code === 'forbidden-geometry-field')).toBe(true)
    }
  })

  it('does not flag ordinary words that merely contain "x" or "y" as geometry keys', () => {
    const findings = scanForForbiddenContent({ complexity: 'high', category: 'workflow' })
    expect(findings).toEqual([])
  })

  it('runs before schema parsing so a forbidden-content draft is never reported as a plain schema error', () => {
    const attacked = withObjectPatch({ names: { en: '<script>alert(1)</script>' } })
    const result = validateArisAiDraft(attacked)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.findings.every((f) => f.code.startsWith('forbidden-'))).toBe(true)
    }
  })
})
