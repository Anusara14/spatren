import { liveQuery } from 'dexie'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { db, type LocalMedia, type LocalRecord } from '../lib/db'
import { MAX_VOICE_S, RATINGS } from '../lib/experience'
import { clock } from '../lib/geo'
import { compressImage, extFor } from '../lib/media'
import { useRecorder } from '../lib/useRecorder'
import { syncNow } from '../lib/sync'
import { currentFix, type Fix } from '../lib/tracking'
import { IconCamera, IconClose } from './icons'
import RecordControls from './RecordControls'
import RecordSheet from './RecordSheet'

type Kind = Exclude<LocalRecord['kind'], 'survey'>

export default function Capture({ onBack, initialKind = 'observation' }: { onBack?: () => void; initialKind?: Kind }) {
  const [kind, setKind] = useState<Kind>(initialKind)
  const [rating, setRating] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<LocalMedia[]>([])
  // A call during a recording can split it into parts: all of them are kept.
  const [audios, setAudios] = useState<LocalMedia[]>([])
  const [audioSecs, setAudioSecs] = useState(0)
  const recorder = useRecorder()
  const recording = recorder.active
  const [consent, setConsent] = useState(false)
  const [participants, setParticipants] = useState('1')
  const [fix, setFix] = useState<Fix | null>(null)
  const [locating, setLocating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [mine, setMine] = useState<LocalRecord[]>([])
  const [viewing, setViewing] = useState<LocalRecord | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => void locate(), [])
  useEffect(() => {
    const sub = liveQuery(() => db.records.orderBy('recorded_at').reverse().limit(30).toArray()).subscribe({ next: setMine })
    return () => sub.unsubscribe()
  }, [])
  // Experience voice notes are shared with the batch, so they stay short.
  useEffect(() => {
    if (recording && kind === 'experience' && recorder.secs >= MAX_VOICE_S) void stopRecording()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.secs, kind, recording])
  useEffect(() => {
    if (recorder.error) setToast(recorder.error)
  }, [recorder.error])
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

  async function stopRecording() {
    const secs = recorder.secs
    const files = await recorder.stop('audio')
    setAudios(files)
    setAudioSecs(secs)
  }

  const audio = audios.length > 0
  const needsConsent = kind === 'interview' && audio
  const isExp = kind === 'experience'
  const canSave = !recording && (isExp ? rating != null : notes.trim() || photos.length || audio) && (!needsConsent || consent)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    const rec: LocalRecord = {
      id: crypto.randomUUID(),
      kind,
      category: kind === 'interview' ? 'Interview' : kind === 'note' ? 'Note' : isExp ? 'Experience' : 'Observation',
      title: title.trim(),
      notes: notes.trim(),
      lat: fix?.lat ?? null,
      lng: fix?.lng ?? null,
      accuracy: fix?.accuracy ?? null,
      recorded_at: new Date().toISOString(),
      media: [...photos, ...audios],
      data: kind === 'interview' ? { consent, participants: Number(participants) || 1, audio_seconds: audio ? audioSecs : 0 } : isExp ? { rating } : {},
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
    setAudios([])
    setConsent(false)
    setRating(null)
    setToast(isExp ? (navigator.onLine ? 'Shared on the experience map.' : 'Saved. It goes on the experience map when you are online.') : navigator.onLine ? 'Saved. Uploading…' : 'Saved on this phone. Will upload when online.')
    void syncNow()
    void locate()
  }

  return (
    <form className="stack" onSubmit={save} style={{ gap: 18 }}>
      {toast && <div className="toast">{toast}</div>}
      <header className="stack" style={{ gap: 4 }}>
        <div className="row between">
          <h1 style={{ fontSize: 28, letterSpacing: '-0.03em' }}>{isExp ? 'Share an experience' : 'Quick observation'}</h1>
          {onBack && <button type="button" className="glass-btn sm" aria-label="Back to Collect" onClick={onBack}><IconClose /></button>}
        </div>
      </header>

      <div className="segmented" role="group" aria-label="Record type">
        {(['experience', 'observation', 'interview', 'note'] as Kind[]).map((k) => (
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

      {isExp && (
        <fieldset className="field rating-field">
          <legend>How was this place?</legend>
          <div className="rating-row" role="radiogroup" aria-label="Rating">
            {RATINGS.map((r) => (
              <button type="button" key={r.value} role="radio" aria-checked={rating === r.value} className={`rating-btn ${rating === r.value ? 'on' : ''}`}
                style={{ ['--r' as string]: r.color }} onClick={() => setRating(r.value)}>
                <span aria-hidden="true">{r.emoji}</span>
                {r.label}
              </button>
            ))}
          </div>
          <p className="tiny muted">Shared with your batch on the experience map, with your name. Voice notes up to 1 minute.</p>
          {!fix && !locating && <p className="tiny" style={{ color: 'var(--danger)' }}>No GPS yet: it will be shared without a map pin. Press Refresh outdoors first.</p>}
        </fieldset>
      )}

      <div className="field">
        <label htmlFor="title">{isExp ? 'Place' : 'Title'}</label>
        <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isExp ? 'e.g. New bus stand, Jaffna junction' : 'Anything: a place, a person, an issue'} />
      </div>

      <div className="field">
        <label htmlFor="notes">{kind === 'interview' ? 'Key points / facilitator notes' : isExp ? 'What was it like? (optional)' : 'Notes'}</label>
        <textarea id="notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={isExp ? 'Crowded, safe, dirty, shaded, noisy… Sinhala, Tamil or English is fine' : 'Sinhala, Tamil or English is fine'} />
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
        <RecordControls
          state={recorder.state}
          secs={recorder.secs}
          limit={isExp ? '/ 1:00' : undefined}
          startLabel={audio ? 'Record again' : isExp ? 'Voice note' : 'Record audio'}
          onStart={() => { setAudios([]); void recorder.start() }}
          onTogglePause={recorder.togglePause}
          onStop={() => void stopRecording()}
        />
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
      {!recording && audios.map((a) => <AudioPreview key={a.name} blob={a.blob} />)}
      {!recording && audio && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAudios([])}>Remove recording</button>}

      {needsConsent && (
        <label className="card-flat row" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2 }} />
          <span className="small">The participant agreed to be recorded for this university study, and knows the recording is only shared with the research team.</span>
        </label>
      )}

      <button className="btn btn-primary btn-block" disabled={!canSave}>{isExp ? (rating == null ? 'Pick a rating to share' : 'Share experience') : 'Save record'}</button>

      <section className="card">
        <div className="row between" style={{ marginBottom: 6 }}>
          <h2 style={{ fontSize: 17 }}>My records</h2>
          <span className="chip">{mine.length}</span>
        </div>
        {mine.length === 0 && <p className="muted small">Nothing yet. Your first observation will appear here.</p>}
        {mine.length > 0 && <p className="tiny muted">Tap one to see, play back or correct it.</p>}
        {mine.map((r) => {
          const img = r.media.find((m) => m.type.startsWith('image'))
          return (
            <button type="button" className="list-item record-row" key={r.id} onClick={() => setViewing(r)} aria-label={`View or edit ${r.title || r.category || r.kind}`}>
              {img ? <Thumb blob={img.blob} /> : <div className="thumb" />}
              <div className="grow">
                <div className="row between">
                  <b style={{ fontSize: 14 }}>{r.title || r.category || r.kind}</b>
                  <span className={`chip ${r.synced ? 'chip-lime' : ''}`}>{r.synced ? 'Uploaded' : 'On phone'}</span>
                </div>
                <p className="small muted">{r.kind} · {clock(r.recorded_at)} · {r.media.length} files</p>
                {r.notes && <p className="small" style={{ marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.notes}</p>}
              </div>
            </button>
          )
        })}
      </section>
      {viewing && <RecordSheet record={viewing} onClose={() => setViewing(null)} onToast={setToast} />}
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
