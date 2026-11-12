import { getVersion } from '@tauri-apps/api/app'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import * as api from './lib/api'
import { aiKey, saveAiKey, testKey } from './lib/ai'

interface Props {
  watchDir: string
  onWatchDir: (dir: string) => void
  onModelChange: () => void
  onClose: () => void
  onStatus: (t: string, error?: boolean) => void
}

/** Transcription engine and model, the optional AI key and the auto-import folder. */
export default function Settings({ watchDir, onWatchDir, onModelChange, onClose, onStatus }: Props) {
  const [st, setSt] = useState<{ installed: boolean; path: string; engine: boolean } | null>(null)
  const [key, setKey] = useState(aiKey())
  const [version, setVersion] = useState('')
  const [installing, setInstalling] = useState(false)
  const [testing, setTesting] = useState(false)
  const refresh = () => void api.modelStatus().then(setSt).catch((e) => onStatus(String(e), true))
  useEffect(refresh, [])
  useEffect(() => void getVersion().then(setVersion).catch(() => undefined), [])

  async function addModel() {
    const picked = await open({ multiple: false, filters: [{ name: 'Whisper model (GGML)', extensions: ['bin'] }] })
    if (!picked || Array.isArray(picked)) return
    setInstalling(true)
    try {
      await api.installModel(picked)
      onStatus('Sinhala model installed. You can transcribe now.')
      refresh()
      onModelChange()
    } catch (e) {
      onStatus(String(e), true)
    } finally {
      setInstalling(false)
    }
  }

  async function checkKey() {
    setTesting(true)
    try {
      await testKey(key.trim())
      saveAiKey(key)
      onStatus('Gemini key works and is saved on this laptop.')
    } catch (e) {
      onStatus(String(e instanceof Error ? e.message : e), true)
    } finally {
      setTesting(false)
    }
  }

  async function pickWatch() {
    const dir = await open({ directory: true, multiple: false })
    if (dir && !Array.isArray(dir)) onWatchDir(dir)
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
        {st && !st.installed && <p className="small muted">Get <b>ggml-sinhala-small.bin</b> from the admin's shared folder (about 175 MB), then add it here once.</p>}
        <div className="row">
          <button className="btn btn-lime btn-sm" disabled={installing} onClick={() => void addModel()}>{installing ? 'Copying the model…' : st?.installed ? 'Replace model…' : 'Add model file…'}</button>
        </div>
        {st && <p className="tiny muted">Stored at {st.path}</p>}
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Receive from phones automatically</h2>
        <p className="small muted">
          Install <b>LocalSend</b> (free, localsend.org) on this laptop and the phones. Pick LocalSend's download folder here, and every SPATREN ZIP sent over Wi-Fi is imported by itself.
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => void pickWatch()}>{watchDir ? 'Change folder…' : 'Choose folder…'}</button>
          {watchDir && <button className="btn btn-ghost btn-sm" onClick={() => onWatchDir('')}>Stop watching</button>}
        </div>
        {watchDir && <p className="tiny muted">Watching {watchDir}</p>}
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <h2 className="section-title" style={{ margin: 0 }}>AI help (optional, online)</h2>
        <p className="small muted">Used only for English translation and theme drafts. Transcripts are sent to Google Gemini with your own free key; audio never leaves this laptop.</p>
        <ol className="steps small">
          <li>Open <b>aistudio.google.com/apikey</b> and sign in with Google.</li>
          <li>Click <b>Create API key</b> and copy it.</li>
          <li>Paste it below and press <b>Test and save</b>.</li>
        </ol>
        <div className="row">
          <input className="input grow" type="password" autoComplete="off" placeholder="Gemini API key" value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="btn btn-lime btn-sm" disabled={!key.trim() || testing} onClick={() => void checkKey()}>{testing ? 'Testing…' : 'Test and save'}</button>
          {aiKey() && <button className="btn btn-ghost btn-sm" onClick={() => { saveAiKey(''); setKey(''); onStatus('Key removed.') }}>Remove</button>}
        </div>
      </section>


      <section className="card stack" style={{ gap: 6 }}>
        <h2 className="section-title" style={{ margin: 0 }}>About</h2>
        <p className="small muted">SPATREN Desktop {version} (beta demo). Everything runs on this computer: recordings and transcripts are never uploaded. Machine transcripts are a strong draft, not final text; correct them while listening.</p>
        <p className="small muted">Developed by <b>Anusara14</b> · codemypage</p>
      </section>
    </div>
  )
}
