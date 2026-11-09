import { liveQuery } from 'dexie'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { db, type LocalMedia, type LocalRecord } from '../lib/db'
import { clock } from '../lib/geo'
import { compressImage, extFor, startRecording, type Recording } from '../lib/media'
import { syncNow } from '../lib/sync'
import { currentFix, type Fix } from '../lib/tracking'
import { IconCamera, IconClose, IconMic } from './icons'

type Kind = Exclude<LocalRecord['kind'], 'survey'>

export const CATEGORIES = [
  'Land use', 'Building condition', 'Street condition', 'Road infrastructure', 'Pedestrian access', 'Public space',
  'Transport', 'Drainage', 'Environment', 'Urban facilities', 'Community infrastructure', 'Safety', 'Accessibility issue',
  'Heritage', 'Other',
]
const INTERVIEW_TYPES = ['Resident', 'Shop / business owner', 'Official', 'Community leader', 'Focus group', 'Other']

export default function Capture({ onBack }: { onBack?: () => void }) {
  const [kind, setKind] = useState<Kind>('observation')
  const [category, setCategory] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<LocalMedia[]>([])
  const [audio, setAudio] = useState<LocalMedia | null>(null)
  const [recording, setRecording] = useState<{ rec: Recording; started: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [consent, setConsent] = useState(false)
  const [participants, setParticipants] = useState('1')
  const [fix, setFix] = useState<Fix | null>(null)
  const [locating, setLocating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [mine, setMine] = useState<LocalRecord[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => void locate(), [])
  useEffect(() => {
    const sub = liveQuery(() => db.records.orderBy('recorded_at').reverse().limit(30).toArray()).subscribe({ next: setMine })
    return () => sub.unsubscribe()
  }, [])
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setElapsed(Math.round((Date.now() - recording.started) / 1000)), 500)
    return () => clearInterval(id)
  }, [recording])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(id)
  }, [toast])

  async function locate() {
    setLocating(true)
    setFix(await currentFix())
    setLocating(false)
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return
    const added: LocalMedia[] = []
    for (const f of Array.from(files)) {
      const blob = await compressImage(f)
      added.push({ name: `photo-${Date.now()}-${added.length}.${extFor(blob.type)}`, type: blob.type, blob })
    }
    setPhotos((p) => [...p, ...added])
  }

  async function toggleRecording() {
    if (recording) {
      const blob = await recording.rec.stop()
      setRecording(null)
      setAudio({ name: `audio-${Date.now()}.${extFor(blob.type)}`, type: blob.type, blob })
      return
    }
    try {
      const rec = await startRecording()
      setElapsed(0)
      setRecording({ rec, started: Date.now() })
    } catch {
      setToast('Microphone blocked. Allow it in browser settings.')
    }
  }

  const needsConsent = kind === 'interview' && !!audio
  const canSave = !recording && (notes.trim() || photos.length || audio) && (!needsConsent || consent)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    const rec: LocalRecord = {
      id: crypto.randomUUID(),
      kind,
      category: kind === 'interview' ? category || 'Interview' : category,
      title: title.trim(),
      notes: notes.trim(),
      lat: fix?.lat ?? null,
      lng: fix?.lng ?? null,
      accuracy: fix?.accuracy ?? null,
      recorded_at: new Date().toISOString(),
      media: [...photos, ...(audio ? [audio] : [])],
      data: kind === 'interview' ? { consent, participants: Number(participants) || 1, audio_seconds: audio ? elapsed : 0 } : {},
      synced: 0,
    }
    try {
      await db.records.add(rec)
    } catch (err: unknown) {
      setToast(`Could not save on this phone: ${err instanceof Error ? err.message : 'storage error'}. Free up space and try again.`)
      return
    }
    setTitle('')
    setNotes('')
    setPhotos([])
    setAudio(null)
    setConsent(false)
    setToast(navigator.onLine ? 'Saved. Uploading…' : 'Saved on this phone. Will upload when online.')
    void syncNow()
    void locate()
  }

  return (
    <form className="stack" onSubmit={save} style={{ gap: 18 }}>
      {toast && <div className="toast">{toast}</div>}
      <header className="stack" style={{ gap: 4 }}>
        <div className="row between">
          <h1 style={{ fontSize: 28, letterSpacing: '-0.03em' }}>Quick observation</h1>
          {onBack && <button type="button" className="glass-btn sm" aria-label="Back to Collect" onClick={onBack}><IconClose /></button>}
        </div>
      </header>

      <div className="segmented" role="group" aria-label="Record type">
        {(['observation', 'interview', 'note'] as Kind[]).map((k) => (
          <button type="button" key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>

      <div className="card stack">
        <div className="row between">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void locate()} disabled={locating}>
            {locating ? 'Locating…' : 'Refresh'}
          </button>
        </div>
        <p className="mono small">
          {fix ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)} · ±${fix.accuracy} m · ${clock(fix.at)}` : locating ? 'Getting GPS…' : 'No GPS fix. Saved without coordinates.'}
        </p>
      </div>

      <div className="field">
        <label>{kind === 'interview' ? 'Who are you speaking with?' : 'Category'}</label>
        <div className="choice-grid">
          {(kind === 'interview' ? INTERVIEW_TYPES : CATEGORIES).map((c) => (
            <button type="button" key={c} className="choice" aria-pressed={category === c} onClick={() => setCategory(category === c ? '' : c)}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="title">Title (optional)</label>
        <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Flooded junction near bus stand" />
      </div>

      <div className="field">
        <label htmlFor="notes">{kind === 'interview' ? 'Key points / facilitator notes' : 'Notes'}</label>
        <textarea id="notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Sinhala, Tamil or English is fine" />
      </div>

      {kind === 'interview' && (
        <div className="field">
          <label htmlFor="pc">Number of participants</label>
          <input id="pc" className="input" type="number" min={1} inputMode="numeric" value={participants} onChange={(e) => setParticipants(e.target.value)} />
        </div>
      )}

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <input ref={fileInput} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void addPhotos(e.target.files)} />
        <button type="button" className="btn btn-ghost grow" onClick={() => fileInput.current?.click()}>
          <IconCamera width={20} /> Photo {photos.length ? `(${photos.length})` : ''}
        </button>
        <button type="button" className={`btn grow ${recording ? 'btn-danger' : 'btn-ghost'}`} onClick={() => void toggleRecording()}>
          <IconMic width={20} />
          {recording ? `Stop · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : audio ? 'Re-record audio' : 'Record audio'}
        </button>
      </div>

      {photos.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {photos.map((p, i) => (
            <button type="button" key={p.name} style={{ border: 0, padding: 0, background: 'none' }} onClick={() => setPhotos(photos.filter((_, j) => j !== i))} title="Remove">
              <Thumb blob={p.blob} />
            </button>
          ))}
        </div>
      )}
      {audio && <AudioPreview blob={audio.blob} />}

      {needsConsent && (
        <label className="card-flat row" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2 }} />
          <span className="small">The participant agreed to be recorded for this university study, and knows the recording is only shared with the research team.</span>
        </label>
      )}

      <button className="btn btn-primary btn-block" disabled={!canSave}>Save record</button>

      <section className="card">
        <div className="row between" style={{ marginBottom: 6 }}>
          <h2 style={{ fontSize: 17 }}>My records</h2>
          <span className="chip">{mine.length}</span>
        </div>
        {mine.length === 0 && <p className="muted small">Nothing yet. Your first observation will appear here.</p>}
        {mine.map((r) => {
          const img = r.media.find((m) => m.type.startsWith('image'))
          return (
            <div className="list-item" key={r.id}>
              {img ? <Thumb blob={img.blob} /> : <div className="thumb" />}
              <div className="grow">
                <div className="row between">
                  <b style={{ fontSize: 14 }}>{r.title || r.category || r.kind}</b>
                  <span className={`chip ${r.synced ? 'chip-lime' : ''}`}>{r.synced ? 'Uploaded' : 'On phone'}</span>
                </div>
                <p className="small muted">{r.kind} · {clock(r.recorded_at)} · {r.media.length} files</p>
                {r.notes && <p className="small" style={{ marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.notes}</p>}
              </div>
            </div>
          )
        })}
      </section>
    </form>
  )
}

function useBlobUrl(blob: Blob): string {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

function Thumb({ blob }: { blob: Blob }) {
  const url = useBlobUrl(blob)
  return url ? <img className="thumb" src={url} alt="" /> : <div className="thumb" />
}

function AudioPreview({ blob }: { blob: Blob }) {
  const url = useBlobUrl(blob)
  return url ? <audio controls src={url} style={{ width: '100%' }} /> : null
}
