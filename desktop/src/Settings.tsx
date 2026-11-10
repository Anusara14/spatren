import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import * as api from './lib/api'

/** Transcription setup: is the engine bundled, is the Sinhala model installed. */
export default function Settings({ onClose, onStatus }: { onClose: () => void; onStatus: (t: string, error?: boolean) => void }) {
  const [st, setSt] = useState<{ installed: boolean; path: string; engine: boolean } | null>(null)
  const refresh = () => void api.modelStatus().then(setSt).catch((e) => onStatus(String(e), true))
  useEffect(refresh, [])

  async function addModel() {
    const picked = await open({ multiple: false, filters: [{ name: 'Whisper model (GGML)', extensions: ['bin'] }] })
    if (!picked || Array.isArray(picked)) return
    try {
      onStatus('Copying the model…')
      await api.installModel(picked)
      onStatus('Sinhala model installed. You can transcribe now.')
      refresh()
    } catch (e) {
      onStatus(String(e), true)
    }
  }

  return (
    <div className="d-view">
      <header className="row between">
        <h1>Settings</h1>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </header>
      <section className="card stack" style={{ gap: 10 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Transcription</h2>
        <p className="small">Engine: <b>{st ? (st.engine ? 'ready' : 'missing (reinstall SPATREN Desktop)') : '…'}</b></p>
        <p className="small">Sinhala model: <b>{st ? (st.installed ? 'installed' : 'not installed') : '…'}</b></p>
        {st && !st.installed && (
          <p className="small muted">Get <b>ggml-sinhala-small.bin</b> from the admin's shared folder (it's large, ~250–500 MB), then add it here once.</p>
        )}
        <div className="row">
          <button className="btn btn-lime btn-sm" onClick={() => void addModel()}>{st?.installed ? 'Replace model…' : 'Add model file…'}</button>
        </div>
        {st && <p className="tiny muted">Stored at {st.path}</p>}
      </section>
      <section className="card stack" style={{ gap: 6 }}>
        <h2 className="section-title" style={{ margin: 0 }}>About</h2>
        <p className="small muted">Everything runs on this computer: recordings and transcripts are never uploaded. Accuracy on field audio is a strong draft, not final text; correct it while listening.</p>
        <p className="small muted">Developed by <b>Anusara14</b> · codemypage</p>
      </section>
    </div>
  )
}
