import { useEffect, useState } from 'react'
import { PROVIDER_LIST } from '../../../shared/providers'
import { ProviderSection } from './ProviderSection'
import type { SettingsModalProps, SettingsStatus } from './types'
import './settings.css'

const EMPTY_STATUS: SettingsStatus = { encryptionAvailable: true, providers: [] }

/** Pure-UI Settings modal: per-provider credential sections + an encryption
 * warning banner. Talks only through the injected handler props — wave C
 * wires onGetStatus/onGetKeys/onSetKey/onDeleteKey/onTestConnection to IPC. */
export function SettingsModal({
  open,
  onClose,
  onGetStatus,
  onGetKeys,
  onSetKey,
  onDeleteKey,
  onTestConnection
}: SettingsModalProps): JSX.Element | null {
  const [status, setStatus] = useState<SettingsStatus>(EMPTY_STATUS)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    onGetStatus().then((s) => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const configuredById = new Map(status.providers.map((p) => [p.id, p.configured]))

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings-modal">
        <header className="settings-modal__header">
          <h2>Settings</h2>
          <button type="button" className="settings-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {!status.encryptionAvailable && (
          <div className="settings-warning" role="alert">
            OS-level encryption is unavailable on this machine. API keys are being stored in{' '}
            <strong>plain text</strong> in the app's local data folder instead of encrypted. This
            is expected to work everywhere Windows DPAPI is available — if you see this warning on
            your work laptop, treat keys here as less protected than usual.
          </div>
        )}

        <div className="settings-modal__body">
          {PROVIDER_LIST.map((spec) => (
            <ProviderSection
              key={spec.id}
              spec={spec}
              configured={configuredById.get(spec.id) ?? false}
              onGetStatus={onGetStatus}
              onGetKeys={onGetKeys}
              onSetKey={onSetKey}
              onDeleteKey={onDeleteKey}
              onTestConnection={onTestConnection}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
