/**
 * Model explorer — the "pick among the 8 models in a real export" half of the
 * plan §5.1 workspace/model explorer.
 *
 * Models whose type is outside the Section 11.2 canvas scope are still listed
 * (nothing is hidden) but are marked and cannot be activated, because
 * `ArisCanvas.create` refuses them by design.
 */

import { arisText, type ArisStudioModelSummary } from './arisStudioDocument'
import { tk } from './shellI18n'

export interface ArisModelExplorerProps {
  readonly sourceTitle: string
  readonly models: readonly ArisStudioModelSummary[]
  readonly activeModelId: string | null
  readonly lang: 'en' | 'ar'
  readonly onSelect: (modelId: string) => void
}

export function ArisModelExplorer({
  sourceTitle,
  models,
  activeModelId,
  lang,
  onSelect
}: ArisModelExplorerProps): JSX.Element | null {
  if (models.length === 0) return null

  return (
    <nav
      data-orbitpm-aris-model-explorer=""
      aria-label={tk('aris.explorer.modelListAria', 'ARIS models in {source}', {
        source: sourceTitle
      })}
      style={{ padding: '0 0.4rem 0.6rem' }}
    >
      <h3
        style={{
          margin: '0 0 6px',
          padding: '0 0.2rem',
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--orbitpm-muted)'
        }}
      >
        {tk('aris.explorer.models', 'Models')}
      </h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {models.map((model) => {
          const label = arisText(model.names, lang) ?? model.id
          const isActive = model.id === activeModelId
          return (
            <li key={model.id}>
              <button
                type="button"
                className="orbitpm-lite-chrome-btn"
                aria-current={isActive ? 'true' : undefined}
                disabled={!model.renderable}
                data-orbitpm-aris-model={model.id}
                style={{
                  width: '100%',
                  display: 'block',
                  textAlign: 'start',
                  marginBottom: 6,
                  opacity: model.renderable ? 1 : 0.6,
                  borderColor: isActive ? 'var(--orbitpm-primary-bg)' : 'var(--orbitpm-border)'
                }}
                onClick={() => onSelect(model.id)}
              >
                <span style={{ display: 'block', overflowWrap: 'anywhere' }}>{label}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--orbitpm-muted)' }}>
                  {tk(
                    'aris.explorer.modelSummary',
                    '{objects} objects · {connections} connections',
                    {
                      objects: model.objectCount,
                      connections: model.connectionCount
                    }
                  )}
                </span>
                {!model.renderable && (
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--orbitpm-muted)' }}>
                    {tk(
                      'aris.canvas.unsupportedModelType',
                      'Model type {type} is outside the supported canvas scope, so it is listed but not drawn.',
                      { type: model.type }
                    )}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
