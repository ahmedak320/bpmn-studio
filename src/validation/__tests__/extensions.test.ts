import BpmnModdle from 'bpmn-moddle'
import { describe, expect, it } from 'vitest'
import { orbitpmModdleDescriptor } from '../../org/orbitpmModdle'
import { snapshotUnknownExtensions, validateUnknownExtensionPreservation } from '../extensions'
import { UNKNOWN_EXTENSION_XML } from './fixtures'

describe('unknown BPMN extension preservation', () => {
  it('does not mistake canonical moddle types for extensions with a default BPMN namespace', async () => {
    const defaultNamespaceXml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_default"
  targetNamespace="https://example.test/default">
  <process id="Process_default" isExecutable="false" />
</definitions>`
    const prefixedXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_default"
  targetNamespace="https://example.test/default">
  <bpmn:process id="Process_default" isExecutable="false" />
</bpmn:definitions>`

    await expect(snapshotUnknownExtensions(defaultNamespaceXml)).resolves.toEqual([])
    await expect(
      validateUnknownExtensionPreservation(defaultNamespaceXml, prefixedXml)
    ).resolves.toMatchObject({ valid: true, issues: [] })
  })

  it('normalizes a generic extension default namespace to its semantic URI', async () => {
    const defaultVendorNamespace = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_vendor_default"
  targetNamespace="https://example.test/vendor-default">
  <process id="Process_vendor_default" isExecutable="false">
    <extensionElements>
      <payload xmlns="urn:example:vendor-default" key="value"><nested /></payload>
    </extensionElements>
  </process>
</definitions>`
    const prefixedVendorNamespace = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:vendor="urn:example:vendor-default"
  id="Definitions_vendor_default"
  targetNamespace="https://example.test/vendor-default">
  <bpmn:process id="Process_vendor_default" isExecutable="false">
    <bpmn:extensionElements>
      <vendor:payload key="value"><vendor:nested /></vendor:payload>
    </bpmn:extensionElements>
  </bpmn:process>
</bpmn:definitions>`

    await expect(snapshotUnknownExtensions(defaultVendorNamespace)).resolves.toEqual([
      expect.objectContaining({
        kind: 'element',
        namespaceUri: 'urn:example:vendor-default',
        localName: 'payload',
        parentElementId: 'Process_vendor_default'
      })
    ])
    await expect(
      validateUnknownExtensionPreservation(defaultVendorNamespace, prefixedVendorNamespace)
    ).resolves.toMatchObject({ valid: true, issues: [] })
  })

  it('captures opaque attributes and complete nested extension elements', async () => {
    const snapshots = await snapshotUnknownExtensions(UNKNOWN_EXTENSION_XML)
    expect(snapshots).toHaveLength(2)
    expect(snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'attribute',
          namespaceUri: 'urn:example:opaque',
          localName: 'checksum',
          parentElementId: 'Process_extensions'
        }),
        expect.objectContaining({
          kind: 'element',
          namespaceUri: 'urn:example:opaque',
          localName: 'payload',
          parentElementId: 'Process_extensions'
        })
      ])
    )
  })

  it('accepts exact preservation and namespace-prefix-only changes', async () => {
    expect(
      (await validateUnknownExtensionPreservation(UNKNOWN_EXTENSION_XML, UNKNOWN_EXTENSION_XML))
        .valid
    ).toBe(true)

    const renamedPrefix = UNKNOWN_EXTENSION_XML.replace('xmlns:foo=', 'xmlns:vendor=').replaceAll(
      'foo:',
      'vendor:'
    )
    expect(
      (await validateUnknownExtensionPreservation(UNKNOWN_EXTENSION_XML, renamedPrefix)).valid
    ).toBe(true)
  })

  it('blocks dropped or mutated opaque vendor content', async () => {
    const removed = UNKNOWN_EXTENSION_XML.replace(' foo:checksum="abc123"', '').replace(
      '<bpmn:extensionElements>\n      <foo:payload foo:key="value"><foo:nested foo:version="2">opaque text</foo:nested></foo:payload>\n    </bpmn:extensionElements>',
      ''
    )
    const summary = await validateUnknownExtensionPreservation(UNKNOWN_EXTENSION_XML, removed)
    expect(summary.valid).toBe(false)
    expect(summary.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'preservation.extension-attribute-changed',
          blocking: true
        }),
        expect.objectContaining({
          code: 'preservation.extension-element-changed',
          blocking: true
        })
      ])
    )
  })

  it('detects a real moddle round-trip that strips an unknown attribute namespace', async () => {
    const moddle = new BpmnModdle({
      orbitpm: orbitpmModdleDescriptor as unknown as Record<string, unknown>
    }) as unknown as {
      fromXML(xml: string): Promise<{ rootElement: unknown }>
      toXML(root: unknown, options: { format: boolean }): Promise<{ xml: string }>
    }
    const parsed = await moddle.fromXML(UNKNOWN_EXTENSION_XML)
    const serialized = (await moddle.toXML(parsed.rootElement, { format: true })).xml
    // This pinned moddle version serializes `foo:key` on a generic element as
    // unqualified `key`. The preservation gate must catch it instead of
    // silently accepting data loss.
    const summary = await validateUnknownExtensionPreservation(UNKNOWN_EXTENSION_XML, serialized)
    expect(summary.valid).toBe(false)
    expect(summary.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'preservation.extension-element-changed' })
      ])
    )
  })
})
