interface WorkspacePickerProps {
  onChoose: () => void
  busy?: boolean
  error?: string | null
}

/** First-run centered card: no workspace root persisted yet. */
function WorkspacePicker({ onChoose, busy, error }: WorkspacePickerProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%'
      }}
    >
      <div
        style={{
          border: '1px solid rgba(127,127,127,0.3)',
          borderRadius: 12,
          padding: '2.5rem 3rem',
          maxWidth: 420,
          textAlign: 'center',
          boxShadow: '0 8px 30px rgba(0,0,0,0.12)'
        }}
      >
        <h2 style={{ margin: '0 0 0.5rem' }}>Choose your processes folder</h2>
        <p style={{ opacity: 0.75, fontSize: 14, lineHeight: 1.5 }}>
          OrbitPM Process Studio keeps your BPMN diagrams as plain files on disk. Pick a folder
          to use as your workspace — something like{' '}
          <code>Documents\Processes</code> works well and syncs nicely if it lives in OneDrive.
        </p>
        <button
          onClick={onChoose}
          disabled={busy}
          style={{
            marginTop: '1.25rem',
            padding: '0.6rem 1.4rem',
            fontSize: 14,
            borderRadius: 8,
            border: 'none',
            background: '#2563eb',
            color: 'white',
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.7 : 1
          }}
        >
          {busy ? 'Choosing…' : 'Choose folder'}
        </button>
        {error && <p style={{ color: '#d33', fontSize: 13, marginTop: '1rem' }}>{error}</p>}
      </div>
    </div>
  )
}

export default WorkspacePicker
