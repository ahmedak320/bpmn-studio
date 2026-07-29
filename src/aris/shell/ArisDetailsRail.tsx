/**
 * The properties rail, rendered from `src/aris/details`.
 *
 * The details lane is headless by design: `buildAllTabs` returns i18n keys plus
 * interpolation variables and never a display string. This component is the
 * rendering half of that contract — it looks every `labelKey`/`valueKey` up in
 * the dictionary and renders bilingual name rows side by side, which is what
 * plan §13.5 ("all AnimalWF metadata remains available") asks the UI to make
 * true.
 */

import { useMemo, useState } from 'react'

import { t } from '../../i18n'
import type { Key } from '../../i18n'
import {
  ARIS_DETAILS_TAB_LABEL_KEYS,
  ARIS_DETAILS_TAB_ORDER,
  buildAllTabs,
  type ArisDetailRow,
  type ArisDetailsTabId
} from '../details/tabs'
import type { ArisDetailsDocument, ArisDetailsElement } from '../details/seam'
import { prepareAttachmentDownload, scanAttachment } from '../details/attachments'
import {
  METADATA_CATEGORY_LABEL_KEYS,
  defaultMetadataVisibility,
  summarizeMetadata
} from '../details/metadata'
import { tk } from './shellI18n'

function renderValue(row: ArisDetailRow): string {
  if (row.valueKey) {
    return t(row.valueKey as Key, row.vars)
  }
  if (row.missing || row.value === null || row.value === undefined || row.value === '') {
    return tk('aris.details.missing', 'Not set')
  }
  return String(row.value)
}

function DetailRows({ rows }: { rows: readonly ArisDetailRow[] }): JSX.Element {
  if (rows.length === 0) {
    return (
      <p style={{ margin: 0, color: 'var(--orbitpm-muted)', fontSize: 13 }}>
        {tk('aris.details.emptyTab', 'No values for this tab.')}
      </p>
    )
  }
  return (
    <dl className="orbitpm-aris-defs">
      {rows.map((row, index) => (
        <div key={`${row.labelKey}:${index}`} style={{ display: 'contents' }}>
          <dt>{t(row.labelKey as Key, row.vars)}</dt>
          <dd>
            {row.bilingual ? (
              <span style={{ display: 'grid', gap: 2 }}>
                <span lang="en" dir="ltr">
                  {row.bilingual.en ?? tk('aris.details.missing', 'Not set')}
                </span>
                <span lang="ar" dir="rtl">
                  {row.bilingual.ar ?? tk('aris.details.missing', 'Not set')}
                </span>
              </span>
            ) : (
              renderValue(row)
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The §13.1 metadata layers for the model the selection belongs to. Every layer
 * is enabled by default; the counts come from the details lane's own summary.
 */
function MetadataLayers({
  details,
  modelId
}: {
  details: ArisDetailsDocument
  modelId: string | null
}): JSX.Element | null {
  const summary = useMemo(() => {
    const model = modelId ? details.models.get(modelId) : null
    if (!model) return null
    return summarizeMetadata(model.satellites, defaultMetadataVisibility())
  }, [details, modelId])

  const active = summary?.layers.filter((layer) => layer.count > 0) ?? []
  if (active.length === 0) return null

  return (
    <div data-orbitpm-aris-metadata-layers="" style={{ marginTop: 10 }}>
      <h4 style={{ margin: '0 0 6px', fontSize: 13 }}>{tk('aris.rail.metadata', 'Metadata')}</h4>
      <dl className="orbitpm-aris-defs">
        {active.map((layer) => (
          <div key={layer.category} style={{ display: 'contents' }}>
            <dt>{t(METADATA_CATEGORY_LABEL_KEYS[layer.category] as Key)}</dt>
            <dd>{layer.count}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** §13.4: exact-byte attachment download, never previewed or executed. */
function AttachmentActions({
  details,
  element,
  onDownload
}: {
  details: ArisDetailsDocument
  element: ArisDetailsElement
  onDownload: (filename: string, bytes: Uint8Array, mimeType: string) => void
}): JSX.Element | null {
  const attachments = useMemo(() => {
    if (element.kind === 'attachment') {
      const one = details.attachments.get(element.id)
      return one ? [one] : []
    }
    if (element.kind !== 'model') return []
    const model = details.models.get(element.id)
    return model ? [...model.attachments.values()] : []
  }, [details, element])

  if (attachments.length === 0) return null

  return (
    <div data-orbitpm-aris-attachments="" style={{ marginTop: 10, display: 'grid', gap: 6 }}>
      {attachments.slice(0, 25).map((attachment) => (
        <button
          key={attachment.id}
          type="button"
          className="orbitpm-lite-chrome-btn"
          style={{ fontSize: 12, textAlign: 'start' }}
          onClick={() => {
            void scanAttachment(attachment).then((scan) => {
              const download = prepareAttachmentDownload(attachment, scan)
              onDownload(download.filename, download.bytes, download.mimeType)
            })
          }}
        >
          {tk('aris.details.attachment.download', 'Download {name}', {
            name: attachment.displayName
          })}
        </button>
      ))}
    </div>
  )
}

export interface ArisDetailsRailProps {
  readonly details: ArisDetailsDocument
  readonly element: ArisDetailsElement | null
  readonly elementLabel: string | null
  /** The model the canvas is showing, for the §13.1 metadata layer counts. */
  readonly modelId: string | null
  readonly onDownloadAttachment: (filename: string, bytes: Uint8Array, mimeType: string) => void
}

export function ArisDetailsRail({
  details,
  element,
  elementLabel,
  modelId,
  onDownloadAttachment
}: ArisDetailsRailProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<ArisDetailsTabId>('general')
  const tabs = useMemo(() => (element ? buildAllTabs(element, details) : null), [details, element])

  if (!tabs || !element) {
    return (
      <section className="orbitpm-aris-rail__section" data-orbitpm-aris-details="">
        <h3 className="orbitpm-aris-rail__heading" style={{ fontSize: 15 }}>
          {tk('aris.rail.details', 'Details')}
        </h3>
        <p style={{ margin: 0, color: 'var(--orbitpm-muted)', fontSize: 13, lineHeight: 1.5 }}>
          {tk('aris.details.noSelection', 'Select an element on the canvas to inspect it.')}
        </p>
        <MetadataLayers details={details} modelId={modelId} />
      </section>
    )
  }

  return (
    <section
      className="orbitpm-aris-rail__section"
      data-orbitpm-aris-details=""
      aria-label={tk('aris.details.selectionAria', 'Details for {element}', {
        element: elementLabel ?? element.id
      })}
    >
      <h3 className="orbitpm-aris-rail__heading" style={{ fontSize: 15 }}>
        {tk('aris.rail.details', 'Details')}
      </h3>
      <div
        role="tablist"
        aria-label={tk('aris.rail.details', 'Details')}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}
      >
        {ARIS_DETAILS_TAB_ORDER.map((tabId) => (
          <button
            key={tabId}
            type="button"
            role="tab"
            aria-selected={activeTab === tabId}
            className="orbitpm-lite-chrome-btn"
            style={{
              fontSize: 12,
              padding: '0.15rem 0.5rem',
              borderColor:
                activeTab === tabId ? 'var(--orbitpm-primary-bg)' : 'var(--orbitpm-border)'
            }}
            onClick={() => setActiveTab(tabId)}
          >
            {t(ARIS_DETAILS_TAB_LABEL_KEYS[tabId] as Key)}
          </button>
        ))}
      </div>
      <DetailRows rows={tabs[activeTab]} />
      {activeTab === 'attachments' && (
        <AttachmentActions details={details} element={element} onDownload={onDownloadAttachment} />
      )}
      <MetadataLayers details={details} modelId={modelId} />
    </section>
  )
}
