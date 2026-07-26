import BpmnModdle from 'bpmn-moddle'
import { describe, expect, it } from 'vitest'
import { orbitpmModdleDescriptor } from '../../org/orbitpmModdle'
import {
  snapshotUnknownExtensions,
  validateUnknownExtensionPreservation
} from '../extensions'
import { UNKNOWN_EXTENSION_XML } from './fixtures'

describe('unknown BPMN extension preservation', () => {
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

    const renamedPrefix = UNKNOWN_EXTENSION_XML
      .replace('xmlns:foo=', 'xmlns:vendor=')
      .replaceAll('foo:', 'vendor:')
    expect(
      (await validateUnknownExtensionPreservation(UNKNOWN_EXTENSION_XML, renamedPrefix)).valid
    ).toBe(true)
  })

  it('blocks dropped or mutated opaque vendor content', async () => {
    const removed = UNKNOWN_EXTENSION_XML
      .replace(' foo:checksum="abc123"', '')
      .replace(
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
    const summary = await validateUnknownExtensionPreservation(
      UNKNOWN_EXTENSION_XML,
      serialized
    )
    expect(summary.valid).toBe(false)
    expect(summary.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'preservation.extension-element-changed' })
      ])
    )
  })
})
