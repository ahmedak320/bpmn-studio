import { useState } from 'react'

import { t } from './i18n'

export interface ArisGenerationPanelProps {
  onCreatePlaceholder: (input: { name: string; description: string }) => Promise<void> | void
  onOpenAssistant: () => void
  onOpenSettings: () => void
  embedded?: boolean
}

export function ArisGenerationPanel({
  onCreatePlaceholder,
  onOpenAssistant,
  onOpenSettings,
  embedded = false
}: ArisGenerationPanelProps): JSX.Element {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const trimmedDescription = description.trim()

  async function submit(): Promise<void> {
    if (!trimmedDescription || busy) return
    setBusy(true)
    try {
      await onCreatePlaceholder({
        name,
        description: trimmedDescription
      })
      setName('')
      setDescription('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label={t('ai.header')}
      style={{
        display: 'grid',
        gap: 10,
        padding: embedded ? '0.75rem 0.8rem 0.9rem' : '1rem',
        border: embedded ? 'none' : '1px solid var(--orbitpm-border)',
        borderRadius: embedded ? 0 : 12,
        background: embedded ? 'transparent' : 'var(--orbitpm-panel-bg, var(--orbitpm-bg))'
      }}
    >
      <div style={{ display: 'grid', gap: 4 }}>
        <strong style={{ fontSize: 14 }}>{t('ai.header')}</strong>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--orbitpm-muted)', lineHeight: 1.5 }}>
          {t('aris.ai.body')}
        </p>
      </div>

      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>{t('aris.ai.name')}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('aris.ai.namePlaceholder')}
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid var(--orbitpm-border)',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            padding: '0.45rem 0.55rem'
          }}
        />
      </label>

      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
          {t('aris.ai.description')}
        </span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t('aris.ai.descriptionPlaceholder')}
          rows={6}
          style={{
            width: '100%',
            minHeight: 120,
            resize: 'vertical',
            borderRadius: 8,
            border: '1px solid var(--orbitpm-border)',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            padding: '0.55rem 0.6rem'
          }}
        />
      </label>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className="orbitpm-lite-primary"
          onClick={() => void submit()}
          disabled={!trimmedDescription || busy}
        >
          {busy ? t('aris.ai.creating') : t('aris.ai.create')}
        </button>
        <button type="button" className="orbitpm-lite-chrome-btn" onClick={onOpenAssistant}>
          {t('aris.placeholder.openAssistant')}
        </button>
        <button type="button" className="orbitpm-lite-chrome-btn" onClick={onOpenSettings}>
          {t('app.settings')}
        </button>
      </div>
    </section>
  )
}

export default ArisGenerationPanel
