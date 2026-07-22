import { useEffect, useState } from 'react'
import { LITE_PROVIDERS } from '../ai/providersLite'
import { getKey, setKey, clearKey, keyLast4, KEY_STORAGE_WARNING } from '../ai/keys'
import type { LiteProviderId } from '../ai/browserAi'

export interface SettingsDialogLiteProps {
  open: boolean
  onClose: () => void
  /** Called after keys change so the AI panel can re-evaluate availability. */
  onKeysChanged: () => void
}

/**
 * Minimal API-key manager for the two browser-capable providers. Fields are
 * write-only: an already-stored key shows a "Configured (••••1234)" placeholder
 * and is only overwritten when you type a new value + Save; Clear removes it.
 * Keys go to localStorage — the warning banner makes that explicit.
 */
export function SettingsDialogLite({
  open,
  onClose,
  onKeysChanged
}: SettingsDialogLiteProps): JSX.Element | null {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDrafts({})
      setSaved(null)
    }
  }, [open])

  if (!open) return null

  const save = (): void => {
    for (const p of LITE_PROVIDERS) {
      const draft = drafts[p.id]
      if (draft !== undefined && draft.trim().length > 0) {
        setKey(p.id, draft)
      }
    }
    setDrafts({})
    setSaved('Saved.')
    onKeysChanged()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      style={overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div style={panel}>
        <header style={header}>
          <strong>Settings — AI keys</strong>
          <button type="button" onClick={onClose} aria-label="Close" style={closeBtn}>
            ×
          </button>
        </header>

        <div style={{ padding: '0.9rem 1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={warning} role="note">
            ⚠️ {KEY_STORAGE_WARNING}
          </div>

          {LITE_PROVIDERS.map((p) => {
            const configured = getKey(p.id).length > 0
            const last4 = keyLast4(p.id)
            const value = drafts[p.id] ?? ''
            return (
              <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{p.label}</span>
                  <a
                    href={p.keysUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    style={{ fontSize: 12, color: 'var(--orbitpm-accent)' }}
                  >
                    Get a key ↗
                  </a>
                </div>
                <input
                  type="password"
                  autoComplete="off"
                  value={value}
                  placeholder={configured ? `Configured (••••${last4}) — type to replace` : 'Paste API key'}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  style={input}
                />
                {configured && (
                  <button
                    type="button"
                    onClick={() => {
                      clearKey(p.id as LiteProviderId)
                      setDrafts((d) => {
                        const next = { ...d }
                        delete next[p.id]
                        return next
                      })
                      setSaved('Key cleared.')
                      onKeysChanged()
                    }}
                    style={{ ...ghostBtn, alignSelf: 'flex-start' }}
                  >
                    Clear stored key
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <footer style={footer}>
          {saved && <span style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>{saved}</span>}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={ghostBtn}>
            Close
          </button>
          <button type="button" onClick={save} className="orbitpm-lite-primary" style={{ fontSize: 13 }}>
            Save keys
          </button>
        </footer>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1500
}
const panel: React.CSSProperties = {
  width: 480,
  maxWidth: '92vw',
  maxHeight: '86vh',
  overflow: 'auto',
  background: 'var(--orbitpm-panel-bg)',
  borderRadius: 10,
  boxShadow: '0 10px 40px rgba(0,0,0,0.35)'
}
const header: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0.75rem 1rem',
  borderBottom: '1px solid var(--orbitpm-border)'
}
const footer: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '0.7rem 1rem',
  borderTop: '1px solid var(--orbitpm-border)'
}
const warning: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  padding: '0.6rem 0.7rem',
  borderRadius: 8,
  background: 'rgba(234,179,8,0.15)',
  border: '1px solid rgba(234,179,8,0.4)'
}
const input: React.CSSProperties = {
  padding: '0.45rem 0.55rem',
  borderRadius: 6,
  border: '1px solid rgba(127,127,127,0.4)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13
}
const closeBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  fontSize: 20,
  cursor: 'pointer',
  lineHeight: 1
}
const ghostBtn: React.CSSProperties = {
  padding: '0.4rem 0.7rem',
  borderRadius: 6,
  border: '1px solid rgba(127,127,127,0.35)',
  background: 'transparent',
  fontSize: 13,
  cursor: 'pointer'
}

export default SettingsDialogLite
