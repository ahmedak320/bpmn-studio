// The unified "Step details" dialog for the OrbitPM org pack. It is deliberately
// DUMB: it holds a local copy of the editable values and hands the whole bag to
// `onApply` — the App decides how to write them (element org props + linked
// note, or process org props + documentation + the first start event's trigger).
//
// Sections render conditionally on `mode` + `elementType`:
//   * Names  — always (bilingual nameEn/nameAr, no section header).
//   * Owner  — always (owner name/type combobox + RACI role); element mode
//              additionally edits the responsible-people list.
//   * Note   — always (element: the linked TextAnnotation; process: the docs).
//   * Step data — element mode, every type: inputs / outputs / supporting
//              system / CC list, plus decision basis on gateways and
//              business-rule tasks only.
//   * Channel — element mode, activity / sub-process / call-activity / interm. event.
//   * CC      — element mode, task-family types only (legacy checkbox + ccTo).
//   * Trigger — process mode, or a start event in element mode. A `dmthub`
//               trigger REQUIRES a service name (inline error, Apply disabled).
//
// The multi-value fields (inputs/outputs/respList/ccList) are textareas that
// hold the '\n'-joined `orbitpm:*` attribute value VERBATIM — one entry per
// line; the App maps them from/to the attrs (see splitList/joinList).

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { OwnerPicker, type OwnerPickerLabels } from '../owner/OwnerPicker'
import type { OwnerEntry } from '../owner/ownersIndex'
import { isDecisionBasisType } from './orgRenderer'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'

export interface StepDetailsValues {
  owner: string
  ownerType: string
  ownerRole: string
  note: string
  channel: string
  channelDetail: string
  cc: boolean
  ccTo: string
  trigger: string
  triggerService: string
  triggerDetail: string
  /** Bilingual element/process names. */
  nameEn: string
  nameAr: string
  /** '\n'-joined lists, held verbatim (one entry per textarea line). */
  inputs: string
  outputs: string
  system: string
  respList: string
  ccList: string
  /** Decision basis — only editable on gateways / business-rule tasks. */
  decisionBasis: string
}

export interface StepDetailsDialogProps {
  mode: 'element' | 'process'
  /** bpmn:* type of the selected element (element mode only). */
  elementType?: string
  initial: StepDetailsValues
  /** Owner-name autocomplete suggestions, aggregated across the workspace. */
  ownerEntries: OwnerEntry[]
  onApply: (values: StepDetailsValues) => void
  onCancel: () => void
  /** When provided, a tertiary "Export owners (CSV)" button is shown. */
  onExportOwners?: () => void
  /**
   * Missing-info categories to visually highlight (MissingCategory names:
   * 'owner' | 'inputs' | 'outputs' | 'basis' | 'trigger') — the canvas
   * missing-badge click hands its categories here. Each highlight is an amber
   * ring + hint on the matching control, cleared as soon as that field is
   * edited; the first highlighted control is scrolled into view on open.
   * Categories whose section is hidden for the current mode/type are ignored.
   */
  highlightFields?: string[]
}

// --- which element types get which sections ---------------------------------

const TASK_FAMILY: ReadonlySet<string> = new Set([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:ManualTask',
  'bpmn:BusinessRuleTask',
  'bpmn:ScriptTask'
])

// Channel applies to any activity (incl. task family), sub-process family,
// call activity, and the two intermediate event kinds.
const CHANNEL_TYPES: ReadonlySet<string> = new Set([
  ...TASK_FAMILY,
  'bpmn:CallActivity',
  'bpmn:SubProcess',
  'bpmn:Transaction',
  'bpmn:AdHocSubProcess',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent'
])

function ownerPickerLabels(): OwnerPickerLabels {
  return {
    nameLabel: t('owner.name.label'),
    namePlaceholder: t('owner.name.placeholder'),
    typeLabel: t('owner.type.label'),
    typeIndividual: t('owner.type.individual'),
    typeDepartment: t('owner.type.department'),
    typeDivision: t('owner.type.division'),
    typeNone: t('owner.type.none'),
    suggestionsAria: t('owner.suggestions.aria'),
    browseAria: t('owner.browse.aria'),
    emptyState: t('owner.empty')
  }
}

// --- missing-info highlighting -----------------------------------------------

/** Edited field → the highlighted MissingCategory that edit satisfies (the
 *  matching amber ring is cleared on the first change to any mapped field). */
const FIELD_TO_CATEGORY: Partial<Record<keyof StepDetailsValues, string>> = {
  owner: 'owner',
  ownerType: 'owner',
  respList: 'owner',
  inputs: 'inputs',
  outputs: 'outputs',
  decisionBasis: 'basis',
  trigger: 'trigger',
  triggerService: 'trigger',
  triggerDetail: 'trigger'
}

/** Categories in on-screen order — the scroll-into-view target is the FIRST
 *  highlighted one that actually rendered a control. */
const HIGHLIGHT_ORDER = ['owner', 'inputs', 'outputs', 'basis', 'trigger'] as const

/** Amber ring — #c47f17 is PALETTE.basisBorder, the canvas badge's own color. */
const highlightRing: CSSProperties = {
  boxShadow: '0 0 0 2px #c47f17',
  borderRadius: 8,
  padding: 4
}
const highlightHintStyle: CSSProperties = { fontSize: 11.5, color: '#c47f17' }

// --- shared inline styles (var(--orbitpm-*) + logical props for RTL) ---------

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.42)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  zIndex: 3000
}
const panel: CSSProperties = {
  width: 480,
  maxWidth: '94vw',
  maxHeight: '88vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--orbitpm-panel-bg)',
  color: 'var(--orbitpm-fg)',
  border: '1px solid var(--orbitpm-border)',
  borderRadius: 12,
  boxShadow: '0 18px 60px rgba(0,0,0,0.4)'
}
const headerStyle: CSSProperties = {
  padding: '0.8rem 1rem',
  borderBottom: '1px solid var(--orbitpm-border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12
}
const bodyStyle: CSSProperties = {
  padding: '1rem',
  overflowY: 'auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 16
}
const footerStyle: CSSProperties = {
  padding: '0.7rem 1rem',
  borderTop: '1px solid var(--orbitpm-border)',
  display: 'flex',
  alignItems: 'center',
  gap: 8
}
const sectionTitle: CSSProperties = { fontSize: 12, fontWeight: 700, opacity: 0.75, letterSpacing: 0.2 }
const labelText: CSSProperties = { fontSize: 12, opacity: 0.8 }
const fieldLabel: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const inputStyle: CSSProperties = {
  padding: '0.4rem 0.5rem',
  borderRadius: 6,
  border: '1px solid rgba(127,127,127,0.4)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box'
}
const textAreaStyle: CSSProperties = {
  padding: '0.4rem 0.5rem',
  borderRadius: 6,
  border: '1px solid rgba(127,127,127,0.4)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
  resize: 'vertical'
}
const closeBtn: CSSProperties = {
  border: 'none',
  background: 'transparent',
  fontSize: 18,
  cursor: 'pointer',
  lineHeight: 1,
  color: 'inherit'
}
const ghostBtn: CSSProperties = {
  padding: '0.45rem 0.8rem',
  borderRadius: 6,
  border: '1px solid rgba(127,127,127,0.35)',
  background: 'transparent',
  fontSize: 13,
  cursor: 'pointer',
  color: 'inherit'
}

function Section({
  title,
  children,
  sectionRef,
  highlight
}: {
  title: string
  children: ReactNode
  /** Ref hook for the missing-info scroll-into-view target. */
  sectionRef?: (node: HTMLElement | null) => void
  /** Paints the amber missing-info ring + hint on the whole section. */
  highlight?: boolean
}): JSX.Element {
  return (
    <section
      ref={sectionRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        ...(highlight ? highlightRing : undefined)
      }}
    >
      <div style={sectionTitle}>{title}</div>
      {highlight && (
        <span role="note" style={highlightHintStyle}>
          {t('missing.highlight.hint')}
        </span>
      )}
      {children}
    </section>
  )
}

export function StepDetailsDialog({
  mode,
  elementType,
  initial,
  ownerEntries,
  onApply,
  onCancel,
  onExportOwners,
  highlightFields
}: StepDetailsDialogProps): JSX.Element {
  useLang()
  const [values, setValues] = useState<StepDetailsValues>(initial)
  // The dialog is mounted fresh per open (App renders it conditionally), so a
  // lazy initializer from the prop is enough — no re-sync needed.
  const [highlights, setHighlights] = useState<Set<string>>(() => new Set(highlightFields ?? []))
  const highlightRefs = useRef<Record<string, HTMLElement | null>>({})

  // Escape closes the dialog (consistent with the app's other modals).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  // Scroll the FIRST highlighted control into view once, on mount. Highlights
  // whose section is hidden for this mode/type never rendered a ref and are
  // skipped (they are simply ignored, per the prop contract).
  useEffect(() => {
    for (const category of HIGHLIGHT_ORDER) {
      if (!highlights.has(category)) continue
      const node = highlightRefs.current[category]
      if (node && typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'center' })
        break
      }
    }
    // Mount-only: the INITIAL highlight set decides the scroll target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isHighlighted = (category: string): boolean => highlights.has(category)

  const highlightRef =
    (category: string) =>
    (node: HTMLElement | null): void => {
      highlightRefs.current[category] = node
    }

  const clearHighlight = (category: string): void => {
    setHighlights((prev) => {
      if (!prev.has(category)) return prev
      const next = new Set(prev)
      next.delete(category)
      return next
    })
  }

  const set = <K extends keyof StepDetailsValues>(key: K, value: StepDetailsValues[K]): void => {
    setValues((prev) => ({ ...prev, [key]: value }))
    const category = FIELD_TO_CATEGORY[key]
    if (category) clearHighlight(category)
  }

  const type = elementType ?? ''
  const showChannel = mode === 'element' && CHANNEL_TYPES.has(type)
  const showCc = mode === 'element' && TASK_FAMILY.has(type)
  const showTrigger = mode === 'process' || type === 'bpmn:StartEvent'
  // All the wave-G step-data fields are element-mode; decision basis is
  // additionally restricted to gateways + business-rule tasks.
  const showStepData = mode === 'element'
  const showDecisionBasis = showStepData && isDecisionBasisType(type)

  // A DMT-Hub trigger must name a service; Apply stays disabled while it is
  // blank (only enforced when the trigger section is actually on screen).
  const triggerServiceMissing =
    showTrigger && values.trigger === 'dmthub' && values.triggerService.trim() === ''
  const applyDisabled = triggerServiceMissing

  const title = mode === 'process' ? t('org.dialog.title.process') : t('org.dialog.title.element')

  return (
    <div
      role="presentation"
      style={overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} style={panel}>
        <header style={headerStyle}>
          <strong style={{ fontSize: 15 }}>{title}</strong>
          <button type="button" onClick={onCancel} aria-label={t('modal.close.aria')} style={closeBtn}>
            ×
          </button>
        </header>

        <div style={bodyStyle}>
          {/* Bilingual names — both modes; the field labels carry the meaning,
              so no section header is needed. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={fieldLabel}>
              <span style={labelText}>{t('org.nameEn.label')}</span>
              <input
                type="text"
                dir="auto"
                value={values.nameEn}
                onChange={(e) => set('nameEn', e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={fieldLabel}>
              <span style={labelText}>{t('org.nameAr.label')}</span>
              <input
                type="text"
                dir="auto"
                value={values.nameAr}
                onChange={(e) => set('nameAr', e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>

          {/* Owner — always */}
          <Section
            title={t('org.section.owner')}
            sectionRef={highlightRef('owner')}
            highlight={isHighlighted('owner')}
          >
            <OwnerPicker
              value={values.owner}
              ownerType={values.ownerType}
              entries={ownerEntries}
              labels={ownerPickerLabels()}
              onChange={(name, ownerType) => {
                clearHighlight('owner')
                setValues((prev) => ({ ...prev, owner: name, ownerType }))
              }}
              autoFocus
            />
            <label style={fieldLabel}>
              <span style={labelText}>{t('org.ownerRole.label')}</span>
              <select
                aria-label={t('org.ownerRole.label')}
                value={values.ownerRole || 'R'}
                onChange={(e) => set('ownerRole', e.target.value)}
                style={inputStyle}
              >
                <option value="R">{t('org.ownerRole.R')}</option>
                <option value="A">{t('org.ownerRole.A')}</option>
                <option value="C">{t('org.ownerRole.C')}</option>
                <option value="I">{t('org.ownerRole.I')}</option>
              </select>
            </label>
            {showStepData && (
              <label style={fieldLabel}>
                <span style={labelText}>{t('org.respList.label')}</span>
                <textarea
                  dir="auto"
                  aria-label={t('org.respList.label')}
                  value={values.respList}
                  placeholder={t('org.respList.hint')}
                  onChange={(e) => set('respList', e.target.value)}
                  rows={3}
                  style={textAreaStyle}
                />
              </label>
            )}
          </Section>

          {/* Note — always (element: linked annotation; process: documentation) */}
          <Section title={t('org.section.note')}>
            <textarea
              dir="auto"
              aria-label={t('org.note.label')}
              value={values.note}
              placeholder={t('org.note.placeholder')}
              onChange={(e) => set('note', e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Section>

          {/* Step data — element mode, every type: inputs / outputs / system /
              CC list; decision basis only on gateways + business-rule tasks. */}
          {showStepData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label
                ref={highlightRef('inputs')}
                style={{ ...fieldLabel, ...(isHighlighted('inputs') ? highlightRing : undefined) }}
              >
                <span style={labelText}>{t('org.inputs.label')}</span>
                <textarea
                  dir="auto"
                  aria-label={t('org.inputs.label')}
                  value={values.inputs}
                  placeholder={t('org.inputs.hint')}
                  onChange={(e) => set('inputs', e.target.value)}
                  rows={3}
                  style={textAreaStyle}
                />
                {isHighlighted('inputs') && (
                  <span role="note" style={highlightHintStyle}>
                    {t('missing.highlight.hint')}
                  </span>
                )}
              </label>
              <label
                ref={highlightRef('outputs')}
                style={{ ...fieldLabel, ...(isHighlighted('outputs') ? highlightRing : undefined) }}
              >
                <span style={labelText}>{t('org.outputs.label')}</span>
                <textarea
                  dir="auto"
                  aria-label={t('org.outputs.label')}
                  value={values.outputs}
                  onChange={(e) => set('outputs', e.target.value)}
                  rows={3}
                  style={textAreaStyle}
                />
                {isHighlighted('outputs') && (
                  <span role="note" style={highlightHintStyle}>
                    {t('missing.highlight.hint')}
                  </span>
                )}
              </label>
              <label style={fieldLabel}>
                <span style={labelText}>{t('org.system.label')}</span>
                <input
                  type="text"
                  dir="auto"
                  value={values.system}
                  onChange={(e) => set('system', e.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={fieldLabel}>
                <span style={labelText}>{t('org.ccList.label')}</span>
                <textarea
                  dir="auto"
                  aria-label={t('org.ccList.label')}
                  value={values.ccList}
                  placeholder={t('org.ccList.hint')}
                  onChange={(e) => set('ccList', e.target.value)}
                  rows={3}
                  style={textAreaStyle}
                />
              </label>
              {showDecisionBasis && (
                <label
                  ref={highlightRef('basis')}
                  style={{ ...fieldLabel, ...(isHighlighted('basis') ? highlightRing : undefined) }}
                >
                  <span style={labelText}>{t('org.decisionBasis.label')}</span>
                  <textarea
                    dir="auto"
                    aria-label={t('org.decisionBasis.label')}
                    value={values.decisionBasis}
                    placeholder={t('org.decisionBasis.hint')}
                    onChange={(e) => set('decisionBasis', e.target.value)}
                    rows={2}
                    style={textAreaStyle}
                  />
                  {isHighlighted('basis') && (
                    <span role="note" style={highlightHintStyle}>
                      {t('missing.highlight.hint')}
                    </span>
                  )}
                </label>
              )}
            </div>
          )}

          {/* Channel — element activities / sub-processes / intermediate events */}
          {showChannel && (
            <Section title={t('org.section.channel')}>
              <select
                aria-label={t('org.section.channel')}
                value={values.channel}
                onChange={(e) => set('channel', e.target.value)}
                style={inputStyle}
              >
                <option value="">{t('org.channel.none')}</option>
                <option value="dmthub">{t('org.channel.dmthub')}</option>
                <option value="email">{t('org.channel.email')}</option>
                <option value="data">{t('org.channel.data')}</option>
              </select>
              {values.channel !== '' && (
                <label style={fieldLabel}>
                  <span style={labelText}>{t('org.channel.detail.label')}</span>
                  <input
                    type="text"
                    dir="auto"
                    value={values.channelDetail}
                    placeholder={
                      values.channel === 'dmthub'
                        ? t('org.channel.dmthub.placeholder')
                        : t('org.channel.detail.placeholder')
                    }
                    onChange={(e) => set('channelDetail', e.target.value)}
                    style={inputStyle}
                  />
                </label>
              )}
            </Section>
          )}

          {/* CC — element task-family only */}
          {showCc && (
            <Section title={t('org.section.cc')}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  aria-label={t('org.cc.label')}
                  checked={values.cc}
                  onChange={(e) => set('cc', e.target.checked)}
                />
                <span style={{ fontSize: 13 }}>{t('org.cc.label')}</span>
              </label>
              <label style={fieldLabel}>
                <span style={labelText}>{t('org.cc.to.label')}</span>
                <input
                  type="text"
                  dir="auto"
                  value={values.ccTo}
                  placeholder={t('org.cc.to.placeholder')}
                  disabled={!values.cc}
                  onChange={(e) => set('ccTo', e.target.value)}
                  style={{ ...inputStyle, opacity: values.cc ? 1 : 0.5 }}
                />
              </label>
            </Section>
          )}

          {/* Trigger — process mode, or a start event in element mode */}
          {showTrigger && (
            <Section title={t('org.section.trigger')}>
              <label
                ref={highlightRef('trigger')}
                style={{ ...fieldLabel, ...(isHighlighted('trigger') ? highlightRing : undefined) }}
              >
                <span style={labelText}>{t('org.trigger.label')}</span>
                <select
                  aria-label={t('org.trigger.label')}
                  value={values.trigger}
                  onChange={(e) => set('trigger', e.target.value)}
                  style={inputStyle}
                >
                  <option value="">{t('org.trigger.none')}</option>
                  <option value="email">{t('org.trigger.email')}</option>
                  <option value="dmthub">{t('org.trigger.dmthub')}</option>
                  <option value="manual">{t('org.trigger.manual')}</option>
                  <option value="schedule">{t('org.trigger.schedule')}</option>
                  <option value="other">{t('org.trigger.other')}</option>
                </select>
                {isHighlighted('trigger') && (
                  <span role="note" style={highlightHintStyle}>
                    {t('missing.highlight.hint')}
                  </span>
                )}
              </label>
              {values.trigger === 'dmthub' && (
                <label style={fieldLabel}>
                  <span style={labelText}>{t('org.trigger.service.label')}</span>
                  <input
                    type="text"
                    dir="auto"
                    value={values.triggerService}
                    placeholder={t('org.trigger.service.placeholder')}
                    aria-invalid={triggerServiceMissing}
                    onChange={(e) => set('triggerService', e.target.value)}
                    style={{
                      ...inputStyle,
                      borderColor: triggerServiceMissing ? '#d63384' : 'rgba(127,127,127,0.4)'
                    }}
                  />
                  {triggerServiceMissing && (
                    <span role="alert" style={{ fontSize: 11.5, color: '#d63384' }}>
                      {t('org.trigger.serviceRequired')}
                    </span>
                  )}
                </label>
              )}
              {values.trigger !== '' && (
                <label style={fieldLabel}>
                  <span style={labelText}>{t('org.trigger.detail.label')}</span>
                  <input
                    type="text"
                    dir="auto"
                    value={values.triggerDetail}
                    placeholder={t('org.trigger.detail.placeholder')}
                    onChange={(e) => set('triggerDetail', e.target.value)}
                    style={inputStyle}
                  />
                </label>
              )}
            </Section>
          )}
        </div>

        <footer style={footerStyle}>
          {onExportOwners && (
            <button
              type="button"
              onClick={onExportOwners}
              style={{ ...ghostBtn, marginInlineEnd: 'auto' }}
            >
              {t('org.export.owners')}
            </button>
          )}
          <button type="button" onClick={onCancel} style={ghostBtn}>
            {t('org.cancel')}
          </button>
          <button
            type="button"
            onClick={() => !applyDisabled && onApply(values)}
            disabled={applyDisabled}
            className="orbitpm-lite-primary"
            style={{
              fontSize: 13,
              fontWeight: 600,
              background: 'var(--orbitpm-accent)',
              color: '#fff',
              border: '1px solid var(--orbitpm-accent)',
              borderRadius: 6,
              padding: '0.45rem 0.9rem',
              cursor: applyDisabled ? 'not-allowed' : 'pointer',
              opacity: applyDisabled ? 0.5 : 1
            }}
          >
            {t('org.apply')}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default StepDetailsDialog
