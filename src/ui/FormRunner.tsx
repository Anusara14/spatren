import { useEffect, useMemo, useRef, useState } from 'react'
import { db, type LocalMedia, type LocalRecord } from '../lib/db'
import { flatQuestions, isVisible, LIKERT, validateAnswer, type Answer, type Answers, type FormDef, type Question } from '../lib/forms'
import { compressImage, extFor, startRecording, type Recording, type RecState } from '../lib/media'
import { toFiles } from '../lib/useRecorder'
import { syncNow } from '../lib/sync'
import { currentFix } from '../lib/tracking'
import { IconCamera, IconClose, IconMic } from './icons'

export interface FormRow {
  id: string
  title: string
  version: number
  definition: FormDef
  /** batch: an admin's form for everyone; group / people: shared by a classmate */
  scope?: 'batch' | 'group' | 'people'
  target_group?: string | null
  shared_with?: string[]
  owner_name?: string | null
  created_by?: string | null
}

interface Props {
  form: FormRow
  onClose: (saved: boolean) => void
  /** try a form without saving a response or a draft */
  preview?: boolean
}

type GpsAnswer = { lat: number; lng: number; accuracy: number }
const draftKey = (id: string) => `spatren.draft.${id}`
/** media key for the whole-survey recording */
const SURVEY_AUDIO = '__survey__'
const pad = (n: number) => String(n).padStart(2, '0')
const mmss = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60)}`

/** A recording in progress: held by the survey (not the question), so moving between questions never stops it. */
interface Live {
  qid: string
  r: Recording
  t0: number
}

export default function FormRunner({ form, onClose, preview = false }: Props) {
  const all = useMemo(() => flatQuestions(form.definition), [form])
  const sectionOf = useMemo(() => {
    const m = new Map<string, string>()
    form.definition.sections.forEach((s) => s.questions.forEach((q) => m.set(q.id, s.title)))
    return m
  }, [form])
  const [answers, setAnswers] = useState<Answers>(() => {
    if (preview) return {}
    try {
      return JSON.parse(localStorage.getItem(draftKey(form.id)) ?? '{}') as Answers
    } catch {
      return {}
    }
  })
  const [media, setMedia] = useState<Record<string, LocalMedia>>({})
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [live, setLive] = useState<Live | null>(null)
  const [secs, setSecs] = useState(0)
  const [recState, setRecState] = useState<RecState>('recording')
  const [micError, setMicError] = useState<string | null>(null)
  const liveRef = useRef<Live | null>(null)
  liveRef.current = live
  const startedAt = useRef(new Date().toISOString())
  const recordAll = !!form.definition.record_audio && !preview

  // Recording clock, and a recording left running is released if the survey screen goes away.
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setSecs(live.r.elapsed()), 500)
    return () => clearInterval(id)
  }, [live])
  useEffect(() => () => liveRef.current?.r.cancel(), [])

  async function startLive(qid: string) {
    setMicError(null)
    if (liveRef.current) await stopLive() // one microphone: finish the running recording first
    try {
      setSecs(0)
      setRecState('recording')
      setLive({ qid, r: await startRecording(undefined, setRecState), t0: Date.now() })
    } catch {
      setMicError('Microphone blocked. Allow it for SPATREN in your phone settings, then try again.')
    }
  }

  /**
   * Stop the running recording and attach it; returns its files keyed for the media map (also used before submit).
   * A call that took the microphone away splits it into parts: part 2+ are kept as `${qid}__part2`… alongside.
   */
  async function stopLive(): Promise<Record<string, LocalMedia> | null> {
    const cur = liveRef.current
    if (!cur) return null
    liveRef.current = null
    setLive(null)
    const files = toFiles(await cur.r.stop(), cur.qid === SURVEY_AUDIO ? 'survey' : cur.qid)
    if (!files.length) return null
    const keyed = Object.fromEntries(files.map((f, i) => [i ? `${cur.qid}__part${i + 1}` : cur.qid, f]))
    setMedia((m) => ({ ...m, ...keyed }))
    return keyed
  }

  function togglePause() {
    const r = liveRef.current?.r
    if (!r) return
    if (r.state() === 'recording') r.pause()
    else void r.resume().catch(() => setMicError('The microphone is still busy (a call?). Tap Resume again in a moment.'))
  }

  // "Record the whole survey": starts with the first question and runs until submit.
  useEffect(() => {
    if (recordAll) void startLive(SURVEY_AUDIO)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordAll])

  const visible = all.filter((q) => isVisible(q, answers))
  const atReview = step >= visible.length
  const q = visible[Math.min(step, visible.length - 1)]
  const progress = Math.min(1, step / Math.max(1, visible.length))

  // Text answers survive an accidental close or reload (media blobs are kept in memory only).
  useEffect(() => {
    if (!preview) localStorage.setItem(draftKey(form.id), JSON.stringify(answers))
  }, [answers, form.id, preview])

  const set = (id: string, v: Answer) => {
    setError(null)
    setAnswers((a) => ({ ...a, [id]: v }))
  }

  function next() {
    if (!atReview) {
      const answer = q.type === 'photo' || q.type === 'audio' ? (hasMedia(q.id) ? 'attached' : null) : answers[q.id]
      const err = validateAnswer(q, answer)
      if (err) return setError(err)
    }
    setError(null)
    setStep((s) => Math.min(s + 1, visible.length))
  }

  // A voice question counts as answered while it is recording, or when the whole survey is being recorded.
  const hasMedia = (qid: string) => !!media[qid] || live?.qid === qid || (recordAll && (!!media[SURVEY_AUDIO] || live?.qid === SURVEY_AUDIO))

  function close() {
    if (liveRef.current && !confirm('Close the survey? The recording so far is discarded; your typed answers are kept as a draft.')) return
    liveRef.current?.r.cancel()
    liveRef.current = null
    onClose(false)
  }

  async function submit() {
    if (preview) {
      liveRef.current?.r.cancel()
      return onClose(false)
    }
    setSaving(true)
    // Anything still recording is stopped and saved with the response, never dropped.
    const last = await stopLive()
    const files: Record<string, LocalMedia> = last ? { ...media, ...last } : media
    const gpsQ = visible.find((x) => x.type === 'gps' && answers[x.id])
    const loc = (gpsQ ? answers[gpsQ.id] : await currentFix(8000)) as GpsAnswer | null
    const kept: Answers = {}
    for (const v of visible) if (v.type !== 'note') kept[v.id] = v.type === 'photo' || v.type === 'audio' ? (files[v.id] ?? (v.type === 'audio' ? files[SURVEY_AUDIO] : undefined))?.name ?? null : answers[v.id] ?? null
    const firstText = visible.find((v) => v.type === 'text' && answers[v.id])
    const text = visible.filter((v) => v.type === 'textarea' || v.type === 'text').map((v) => answers[v.id]).filter(Boolean).join('\n')
    const rec: LocalRecord = {
      id: crypto.randomUUID(),
      kind: 'survey',
      category: form.title,
      title: firstText ? String(answers[firstText.id]) : form.title,
      notes: text,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      accuracy: loc?.accuracy ?? null,
      recorded_at: new Date().toISOString(),
      media: Object.values(files),
      data: {
        form_id: form.id, form_version: form.version, form_title: form.title, answers: kept,
        started_at: startedAt.current, submitted_at: new Date().toISOString(),
        ...(files[SURVEY_AUDIO] ? { survey_audio: files[SURVEY_AUDIO].name } : {}),
      },
      synced: 0,
    }
    try {
      await db.records.add(rec)
    } catch (e: unknown) {
      setSaving(false)
      return setError(`Couldn't save on this phone: ${e instanceof Error ? e.message : 'storage error'}. Free up space and try again.`)
    }
    localStorage.removeItem(draftKey(form.id))
    void syncNow()
    onClose(true)
  }

  return (
    <div className="runner">
      <header className="runner-top">
        <button className="glass-btn sm" aria-label="Close survey (answers are kept as a draft)" onClick={close}><IconClose /></button>
        <div className="grow">
          <div className="runner-meta"><span>{preview ? `Preview · ${form.title}` : form.title}</span><span className="tnum">{Math.min(step + 1, visible.length)} / {visible.length}</span></div>
          <div className="runner-bar"><div style={{ transform: `scaleX(${atReview ? 1 : progress})` }} /></div>
        </div>
      </header>
      {live && (
        <div className="runner-rec" role="status">
          <span className="rec-dot" aria-hidden="true" />
          <span className="grow">
            {recState === 'interrupted' ? 'Paused by a call' : recState === 'paused' ? 'Paused' : 'Recording'}{' '}
            {live.qid === SURVEY_AUDIO ? 'the survey' : `“${all.find((x) => x.id === live.qid)?.label ?? 'voice answer'}”`} · <b className="tnum">{mmss(secs)}</b>
          </span>
          <button className="btn btn-sm btn-ghost" onClick={togglePause}>{recState === 'recording' ? 'Pause' : 'Resume'}</button>
          {live.qid !== SURVEY_AUDIO && <button className="btn btn-sm btn-ghost" onClick={() => void stopLive()}>Stop</button>}
        </div>
      )}
      {micError && <p className="runner-error" role="alert" style={{ margin: '8px 16px 0' }}>{micError}{recordAll ? ' The survey continues without audio.' : ''}</p>}

      <main className="runner-body" key={atReview ? 'review' : q.id}>
        {atReview ? (
          <Review form={form} visible={visible} answers={answers} hasMedia={hasMedia} recording={!!live} onEdit={(i) => setStep(i)} />
        ) : (
          <>
            <p className="runner-section">{sectionOf.get(q.id)}</p>
            <h2 className="runner-q">
              {q.label}
              {q.required && <span className="req" aria-label="required">*</span>}
            </h2>
            {q.hint && <p className="runner-hint">{q.hint}</p>}
            <QuestionInput q={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} media={media[q.id]} onMedia={(m) => setMedia((cur) => {
              const copy = { ...cur }
              if (m) copy[q.id] = m
              else delete copy[q.id]
              return copy
            })} audio={{
              recording: live?.qid === q.id,
              secs,
              wholeSurvey: recordAll && (live?.qid === SURVEY_AUDIO || !!media[SURVEY_AUDIO]),
              onStart: () => void startLive(q.id),
              onStop: () => void stopLive(),
            }} />
          </>
        )}
        {error && <p className="runner-error" role="alert">{error}</p>}
      </main>

      <footer className="runner-foot">
        <button className="btn btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</button>
        {atReview ? (
          <button className="btn btn-lime grow" onClick={() => void submit()} disabled={saving}>{preview ? 'End preview' : saving ? 'Saving…' : 'Submit response'}</button>
        ) : (
          <button className="btn btn-primary grow" onClick={next}>{step === visible.length - 1 ? 'Review' : q.required ? 'Next' : isAnsweredLocal(q, answers, hasMedia) ? 'Next' : 'Skip'}</button>
        )}
      </footer>
    </div>
  )
}

function isAnsweredLocal(q: Question, a: Answers, hasMedia: (qid: string) => boolean): boolean {
  if (q.type === 'photo' || q.type === 'audio') return hasMedia(q.id)
  if (q.type === 'note') return true
  const v = a[q.id]
  return v != null && v !== '' && !(Array.isArray(v) && !v.length)
}

interface AudioControl {
  recording: boolean
  secs: number
  /** the whole survey is being recorded, which covers voice questions too */
  wholeSurvey: boolean
  onStart: () => void
  onStop: () => void
}

interface InputProps {
  q: Question
  value: Answer | undefined
  onChange: (v: Answer) => void
  media?: LocalMedia
  onMedia: (m: LocalMedia | null) => void
  audio: AudioControl
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const nowTime = () => {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function QuestionInput({ q, value, onChange, media, onMedia, audio }: InputProps) {
  // Date and time questions start with the phone's date and time; the student can still change them.
  useEffect(() => {
    if ((q.type === 'date' || q.type === 'time') && (value == null || value === '')) onChange(q.type === 'date' ? today() : nowTime())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id])

  switch (q.type) {
    case 'note':
      return null
    case 'text':
      return <input className="input" autoFocus value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'textarea':
      return <textarea className="input" autoFocus rows={5} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Sinhala, Tamil or English" />
    case 'integer':
    case 'decimal':
      return (
        <input className="input tnum" autoFocus inputMode={q.type === 'integer' ? 'numeric' : 'decimal'} value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value.replace(/[^\d.-]/g, ''))} placeholder={q.min != null || q.max != null ? `${q.min ?? ''}–${q.max ?? ''}` : ''} />
      )
    case 'select_one':
    case 'yes_no':
    case 'likert': {
      const opts = q.type === 'yes_no' ? ['Yes', 'No'] : q.type === 'likert' ? LIKERT : q.options ?? []
      return (
        <div className={`opts ${q.type === 'yes_no' ? 'opts-2' : ''}`} role="radiogroup">
          {opts.map((o) => (
            <button key={o} role="radio" aria-checked={value === o} className="opt" onClick={() => onChange(value === o ? null : o)}>
              <span className="opt-mark" />{o}
            </button>
          ))}
        </div>
      )
    }
    case 'select_multiple': {
      const cur = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="opts" role="group">
          {(q.options ?? []).map((o) => (
            <button key={o} aria-pressed={cur.includes(o)} className="opt opt-multi" onClick={() => onChange(cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o])}>
              <span className="opt-mark" />{o}
            </button>
          ))}
          <p className="runner-hint">Choose all that apply</p>
        </div>
      )
    }
    case 'rating': {
      const n = Number(value) || 0
      return (
        <div className="stars" role="radiogroup" aria-label="Rating out of 5">
          {[1, 2, 3, 4, 5].map((i) => (
            <button key={i} role="radio" aria-checked={n === i} aria-label={`${i} of 5`} className={i <= n ? 'on' : ''} onClick={() => onChange(i)}>
              <svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9Z" /></svg>
            </button>
          ))}
        </div>
      )
    }
    case 'date':
      return <input className="input" type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'time':
      return <input className="input" type="time" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'gps':
      return <GpsInput value={value as GpsAnswer | null} onChange={onChange} />
    case 'photo':
      return <PhotoInput qid={q.id} media={media} onMedia={onMedia} />
    case 'audio':
      return <AudioInput media={media} onMedia={onMedia} control={audio} />
  }
}

function GpsInput({ value, onChange }: { value: GpsAnswer | null; onChange: (v: Answer) => void }) {
  const [busy, setBusy] = useState(false)
  async function capture() {
    setBusy(true)
    const f = await currentFix(20_000)
    setBusy(false)
    if (f) onChange({ lat: f.lat, lng: f.lng, accuracy: f.accuracy })
  }
  useEffect(() => {
    if (!value) void capture()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="media-box">
      <p className="tnum" style={{ fontWeight: 600 }}>
        {value ? `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : busy ? 'Getting GPS…' : 'No location yet'}
      </p>
      {value && <p className="small muted">Accuracy ±{value.accuracy} m{value.accuracy > 50 ? '. Move to open sky and capture again for better accuracy.' : ''}</p>}
      <button className="btn btn-ghost btn-sm" onClick={() => void capture()} disabled={busy}>{value ? 'Capture again' : 'Capture location'}</button>
    </div>
  )
}

function PhotoInput({ qid, media, onMedia }: { qid: string; media?: LocalMedia; onMedia: (m: LocalMedia | null) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const url = useBlobUrl(media?.blob)
  async function pick(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    const blob = await compressImage(f)
    onMedia({ name: `${qid}.${extFor(blob.type)}`, type: blob.type, blob })
  }
  return (
    <div className="media-box">
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void pick(e.target.files)} />
      {url ? <img src={url} alt="Captured" className="media-preview" /> : null}
      <div className="row">
        <button className="btn btn-primary grow" onClick={() => input.current?.click()}><IconCamera width={20} /> {media ? 'Retake photo' : 'Take photo'}</button>
        {media && <button className="btn btn-ghost" onClick={() => onMedia(null)}>Remove</button>}
      </div>
    </div>
  )
}

function AudioInput({ media, onMedia, control }: { media?: LocalMedia; onMedia: (m: LocalMedia | null) => void; control: AudioControl }) {
  const url = useBlobUrl(media?.blob)
  if (control.wholeSurvey && !media)
    return (
      <div className="media-box">
        <p className="small"><span className="rec-dot" aria-hidden="true" /> This answer is in the whole-survey recording. Ask the question and carry on.</p>
      </div>
    )
  return (
    <div className="media-box">
      {url && !control.recording && <audio controls src={url} style={{ width: '100%' }} />}
      <button className={`btn grow ${control.recording ? 'btn-danger' : 'btn-primary'}`} onClick={control.recording ? control.onStop : control.onStart}>
        <IconMic width={20} /> {control.recording ? `Stop · ${mmss(control.secs)}` : media ? 'Record again' : 'Start recording'}
      </button>
      {control.recording && <p className="small muted">Keeps recording if you go to the next question. It stops when you tap Stop or submit.</p>}
      {media && !control.recording && <button className="btn btn-ghost btn-sm" onClick={() => onMedia(null)}>Remove recording</button>}
    </div>
  )
}

function Review({ form, visible, answers, hasMedia, recording, onEdit }: { form: FormRow; visible: Question[]; answers: Answers; hasMedia: (qid: string) => boolean; recording: boolean; onEdit: (i: number) => void }) {
  const answered = visible.filter((v) => v.type !== 'note' && isAnsweredLocal(v, answers, hasMedia)).length
  const total = visible.filter((v) => v.type !== 'note').length
  return (
    <div className="stack" style={{ gap: 12 }}>
      <h2 className="runner-q">Ready to submit</h2>
      <p className="runner-hint">
        {answered} of {total} answered for “{form.title}”. Tap any answer to change it. Location, date and time are added automatically.
        {recording ? ' The recording is still running and is saved when you submit.' : ''}
      </p>
      <div className="review-list">
        {visible.map((v, i) =>
          v.type === 'note' ? null : (
            <button key={v.id} className="review-item" onClick={() => onEdit(i)}>
              <span className="small muted">{v.label}</span>
              <b>{v.type === 'photo' || v.type === 'audio' ? (hasMedia(v.id) ? `${v.type} attached` : '—') : display(answers[v.id])}</b>
            </button>
          ),
        )}
      </div>
    </div>
  )
}

function display(a: Answer | undefined): string {
  if (a == null || a === '') return '—'
  if (Array.isArray(a)) return a.join(', ') || '—'
  if (typeof a === 'object') return `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}`
  return String(a)
}

function useBlobUrl(blob?: Blob): string {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!blob) return setUrl('')
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}
