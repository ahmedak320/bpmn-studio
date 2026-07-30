import { useEffect, useRef, useState } from 'react'

import { t } from '../../i18n'
import { Modal } from '../../workspace/Modal'
import type { ArisBlankModelType } from './arisBlankModel'

export interface ArisNewModelDialogProps {
  readonly open: boolean
  /**
   * The workspace-relative folder the model will be created in, or `null` when
   * there is no writable multi-file target (single-file / picker phase). It only
   * switches the hint copy; the create paths themselves live in `ArisApp`.
   */
  readonly folderRel: string | null
  /**
   * Create-missing preset: when set, the dialog prefills the model name, locks
   * the type to the EPC default (a resolved assignment is always a process), and
   * shows the linked hint naming the id and the function the model will resolve.
   */
  readonly preset?: { name: string; modelId: string; linkContext: string } | null
  readonly lang: 'en' | 'ar'
  readonly onCreate: (spec: { name: string; modelType: ArisBlankModelType }) => void
  readonly onCancel: () => void
}

/**
 * The "New ARIS model" dialog: a name field and a model-type choice (EPC or
 * value-added chain). Mounted only while `open`, so each opening starts from the
 * localized default name with the field focused and selected.
 */
export function ArisNewModelDialog({
  open,
  folderRel,
  preset,
  lang,
  onCreate,
  onCancel
}: ArisNewModelDialogProps): JSX.Element | null {
  if (!open) return null
  return (
    <ArisNewModelDialogBody
      folderRel={folderRel}
      preset={preset ?? null}
      lang={lang}
      onCreate={onCreate}
      onCancel={onCancel}
    />
  )
}

function ArisNewModelDialogBody({
  folderRel,
  preset,
  lang,
  onCreate,
  onCancel
}: Omit<ArisNewModelDialogProps, 'open'>): JSX.Element {
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(() =>
    preset && preset.name.trim() !== '' ? preset.name : t('aris.newModel.nameInitial')
  )
  // A create-missing model always resolves a process assignment, so its type is
  // locked to the EPC default rather than offered as a choice.
  const [modelType, setModelType] = useState<ArisBlankModelType>('MT_EEPC')

  useEffect(() => {
    const input = nameRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [])

  const trimmed = name.trim()
  const canCreate = trimmed !== ''
  const submit = (): void => {
    if (canCreate) onCreate({ name: trimmed, modelType })
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.45rem 0.5rem',
    borderRadius: 6,
    border: '1px solid rgba(127,127,127,0.4)',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    fontSize: 13
  }

  const footer = (
    <>
      <button type="button" className="orbitpm-lite-chrome-btn" onClick={onCancel}>
        {t('modal.cancel')}
      </button>
      <button
        type="button"
        className="orbitpm-lite-chrome-btn"
        disabled={!canCreate}
        onClick={submit}
        style={{
          fontWeight: 600,
          background: 'var(--orbitpm-accent)',
          color: '#fff',
          borderColor: 'var(--orbitpm-accent)',
          opacity: canCreate ? 1 : 0.5,
          cursor: canCreate ? 'pointer' : 'not-allowed'
        }}
      >
        {t('aris.newModel.create')}
      </button>
    </>
  )

  return (
    <Modal
      title={t('aris.newModel.title')}
      onClose={onCancel}
      maxWidth={420}
      initialFocusRef={nameRef}
      footer={footer}
    >
      <div lang={lang} data-orbitpm-aris-new-model="" style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'block', fontSize: 13 }}>
          <span style={{ display: 'block', marginBottom: 6, color: 'var(--orbitpm-muted)' }}>
            {t('aris.newModel.nameLabel')}
          </span>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
            style={fieldStyle}
          />
        </label>
        <label style={{ display: 'block', fontSize: 13 }}>
          <span style={{ display: 'block', marginBottom: 6, color: 'var(--orbitpm-muted)' }}>
            {t('aris.newModel.type')}
          </span>
          <select
            value={modelType}
            onChange={(event) => setModelType(event.target.value as ArisBlankModelType)}
            disabled={preset !== null}
            style={fieldStyle}
          >
            <option value="MT_EEPC">{t('aris.newModel.type.epc')}</option>
            <option value="MT_VAL_ADD_CHN_DGM">{t('aris.newModel.type.vacd')}</option>
          </select>
        </label>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--orbitpm-muted)', lineHeight: 1.5 }}>
          {preset
            ? t('aris.newModel.linkedHint', { id: preset.modelId, name: preset.linkContext })
            : t(
                folderRel === null ? 'aris.newModel.hint.fallback' : 'aris.newModel.hint.directory'
              )}
        </p>
      </div>
    </Modal>
  )
}

export default ArisNewModelDialog
