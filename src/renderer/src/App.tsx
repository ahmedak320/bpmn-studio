import { useEffect, useState } from 'react'

function App(): JSX.Element {
  const [versions, setVersions] = useState<string>('')

  useEffect(() => {
    const api = (window as unknown as { orbitpm?: { versions: Record<string, string> } })
      .orbitpm
    if (api) {
      setVersions(
        `electron ${api.versions.electron} · chrome ${api.versions.chrome} · node ${api.versions.node}`
      )
    }
  }, [])

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>OrbitPM Process Studio</h1>
      <p>Scaffold boots. Workspace, editor, and AI generation land in later waves.</p>
      {versions ? <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>{versions}</p> : null}
    </main>
  )
}

export default App
