// lite/src/org/DetailsCard.tsx — the compact "Details" card stacked ABOVE the
// bpmn-js properties panel in the right side pane (EditorTabLite renders it
// via its `sidePaneExtra` slot in the integration wave). SELF-SUBSCRIBING:
// the card listens to the modeler's own eventBus (selection / command-stack /
// import) and re-derives its content locally, so App never re-renders on a
// canvas selection change. Everything shown comes from the SAME derivation
// the Step-details dialog uses (deriveStepDetailsCtx) plus the renderer's own
// completeness rules (planMissingInfo), so card, badge and dialog can never
// disagree about what is missing.
//
// The `.orbitpm-lite-details-card` class is the app.css hook (integration
// wave); the inline styles below mirror the planned rules so the card is
// presentable standalone.

import { useEffect, useState, type CSSProperties } from 'react'
import { t, type Key } from '../i18n'
import { useLang } from '../i18n/useLang'
import { getDiagramLang, type LangToggleModeler } from '../editor/langToggle'
import { getOrgProps, splitList } from './orgModel'
import { isMissingBadgeEligibleType, planMissingInfo, type MissingCategory } from './orgRenderer'
import {
  deriveStepDetailsCtx,
  type StepDetailsCtx,
  type StepDetailsModeler
} from './stepDetailsCtx'

export interface DetailsCardProps {
  /** The tab's modeler, or null until onModelerReady delivers it. */
  modeler: StepDetailsModeler | null
  /** Opens the full Step-details dialog — same flow as the toolbar button. */
  onOpenDetails: () => void
}

// --- eventBus subscription ---------------------------------------------------

interface EventBusLike {
  on(event: string, priority: number, callback: () => void): void
  off(event: string, callback: () => void): void
}

const SUBSCRIBED_EVENTS = ['selection.changed', 'commandStack.changed', 'import.done'] as const

// --- i18n key maps -----------------------------------------------------------

const MISSING_LABEL_KEYS: Record<MissingCategory, Key> = {
  owner: 'missing.owner',
  inputs: 'missing.inputs',
  outputs: 'missing.outputs',
  basis: 'missing.basis',
  trigger: 'missing.trigger'
}

const OWNER_TYPE_KEYS: Record<string, Key> = {
  individual: 'owner.type.individual',
  department: 'owner.type.department',
  division: 'owner.type.division'
}

// --- inline styles (mirroring the planned app.css rules) ---------------------

const AMBER = '#c47f17' // PALETTE.basisBorder — same amber as the canvas badge
const GREEN = '#1e9e62' // PALETTE.stepGreenBorder

const cardStyle: CSSProperties = {
  flex: '0 0 auto',
  maxHeight: '45%',
  overflowY: 'auto',
  borderBottom: '1px solid var(--orbitpm-editor-border, rgba(127,127,127,0.35))',
  padding: '0.6rem 0.7rem',
  fontSize: 12.5,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minHeight: 0
}

const chipStyle: CSSProperties = {
  padding: '0.1rem 0.45rem',
  borderRadius: 999,
  fontSize: 11,
  background: 'rgba(196, 127, 23, 0.16)',
  border: `1px solid ${AMBER}`,
  whiteSpace: 'nowrap'
}

const openBtnStyle: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '0.3rem 0.6rem',
  borderRadius: 6,
  border: '1px solid rgba(127,127,127,0.35)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer'
}

// --- small render helpers ----------------------------------------------------

function GlanceRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 6, minWidth: 0, alignItems: 'baseline' }}>
      <span style={{ flex: '0 0 auto', opacity: 0.65, fontSize: 11.5 }}>{label}</span>
      <span
        dir="auto"
        style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {value}
      </span>
    </div>
  )
}

/** First entry of a '\n'-joined list plus a "+N more" overflow marker. */
function listGlance(raw: string): string {
  const entries = splitList(raw)
  if (entries.length === 0) return t('details.card.empty')
  if (entries.length === 1) return entries[0]
  return `${entries[0]} ${t('details.card.more', { count: entries.length - 1 })}`
}

// --- the card ----------------------------------------------------------------

export function DetailsCard({ modeler, onOpenDetails }: DetailsCardProps): JSX.Element {
  useLang()
  const [, setTick] = useState(0)

  // Live re-derivation: any selection change, model edit (undo/redo included)
  // or re-import bumps the tick, which re-runs deriveStepDetailsCtx below.
  useEffect(() => {
    if (!modeler) return
    let bus: EventBusLike | undefined
    try {
      bus = modeler.get('eventBus') as EventBusLike
    } catch {
      return
    }
    if (!bus || typeof bus.on !== 'function') return
    const bump = (): void => setTick((tick) => tick + 1)
    for (const event of SUBSCRIBED_EVENTS) bus.on(event, 500, bump)
    return () => {
      for (const event of SUBSCRIBED_EVENTS) {
        try {
          bus.off(event, bump)
        } catch {
          /* modeler torn down first — nothing left to detach */
        }
      }
    }
  }, [modeler])

  let ctx: StepDetailsCtx | null = null
  if (modeler) {
    try {
      ctx = deriveStepDetailsCtx(modeler)
    } catch {
      ctx = null // modeler mid-import/teardown — fall back to the placeholder
    }
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <strong style={{ fontSize: 12.5 }}>{t('details.card.title')}</strong>
      {ctx && (
        <span style={{ fontSize: 11, opacity: 0.65, flex: '0 0 auto' }}>
          {ctx.mode === 'element' ? t('details.card.elementScope') : t('details.card.processScope')}
        </span>
      )}
    </div>
  )

  if (!ctx) {
    return (
      <div className="orbitpm-lite-details-card" style={cardStyle}>
        {header}
        <span style={{ opacity: 0.6 }}>{t('details.card.empty')}</span>
      </div>
    )
  }

  let diagLang: 'en' | 'ar' = 'en'
  try {
    diagLang = getDiagramLang(ctx.modeler as unknown as LangToggleModeler)
  } catch {
    /* keep the 'en' default */
  }

  const initial = ctx.initial
  // Preferred display name: the visible label first (element mode), then the
  // active diagram language's stored side (which deriveStepDetailsCtx already
  // seeded from the visible name when it was blank), then the other side.
  const visible =
    ctx.mode === 'element' && typeof ctx.element?.businessObject?.name === 'string'
      ? ctx.element.businessObject.name
      : ''
  const preferred =
    diagLang === 'ar' ? initial.nameAr || initial.nameEn : initial.nameEn || initial.nameAr
  const displayName = visible.trim() || preferred.trim() || t('details.card.empty')

  // Completeness block — only for types the canvas badge can ever apply to.
  const elementType = typeof ctx.element?.type === 'string' ? ctx.element.type : ''
  const eligible = ctx.mode === 'element' && elementType !== '' && isMissingBadgeEligibleType(elementType)
  let missing: MissingCategory[] = []
  if (eligible && ctx.element) {
    try {
      missing = planMissingInfo(getOrgProps(ctx.element), elementType)
    } catch {
      missing = []
    }
  }

  const ownerTypeKey = OWNER_TYPE_KEYS[initial.ownerType] as Key | undefined
  const ownerValue = initial.owner.trim()
    ? ownerTypeKey
      ? `${initial.owner} · ${t(ownerTypeKey)}`
      : initial.owner
    : t('details.card.empty')

  return (
    <div className="orbitpm-lite-details-card" style={cardStyle}>
      {header}

      <div
        dir="auto"
        style={{
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {displayName}
      </div>

      {ctx.mode === 'process' && (
        <span style={{ fontSize: 11.5, opacity: 0.65 }}>{t('details.card.noSelection')}</span>
      )}

      {eligible &&
        (missing.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: AMBER }}>
              {t('details.card.missingTitle')}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {missing.map((category) => (
                <span key={category} style={chipStyle}>
                  {t(MISSING_LABEL_KEYS[category])}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 11.5, color: GREEN }}>{t('details.card.complete')}</span>
        ))}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <GlanceRow label={t('details.card.owner')} value={ownerValue} />
        {ctx.mode === 'element' && (
          <>
            <GlanceRow label={t('details.card.inputs')} value={listGlance(initial.inputs)} />
            <GlanceRow label={t('details.card.outputs')} value={listGlance(initial.outputs)} />
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onOpenDetails}
        title={t('details.card.open.title')}
        style={openBtnStyle}
      >
        {t('details.card.open')}
      </button>
    </div>
  )
}

export default DetailsCard
