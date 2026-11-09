import { useEffect, useMemo, useRef, useState } from 'react'
import { db, type LocalMedia, type LocalRecord } from '../lib/db'
import { flatQuestions, isVisible, LIKERT, validateAnswer, type Answer, type Answers, type FormDef, type Question } from '../lib/forms'
import { compressImage, extFor, startRecording, type Recording } from '../lib/media'
import { syncNow } from '../lib/sync'
import { currentFix } from '../lib/tracking'
import { IconCamera, IconClose, IconMic } from './icons'

export interface FormRow {
  id: string
  title: string
  version: number
  definition: FormDef
}

interface Props {
  form: FormRow
  onClose: (saved: boolean) => void
}

type GpsAnswer = { lat: number; lng: number; accuracy: number }
const draftKey = (id: string) => `spatren.draft.${id}`

export default function FormRunner({ form, onClose }: Props) {
  const all = useMemo(() => flatQuestions(form.definition), [form])
  const sectionOf = useMemo(() => {
    const m = new Map<string, string>()
    form.definition.sections.forEach((s) => s.questions.forEach((q) => m.set(q.id, s.title)))
    return m
  }, [form])
  const [answers, setAnswers] = useState<Answers>(() => {
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

  const visible = all.filter((q) => isVisible(q, answers))
  const atReview = step >= visible.length
  const q = visible[Math.min(step, visible.length - 1)]
  const progress = Math.min(1, step / Math.max(1, visible.length))

  // Text answers survive an accidental close or reload (media blobs are kept in memory only).
  useEffect(() => {
    localStorage.setItem(draftKey(form.id), JSON.stringify(answers))
  }, [answers, form.id])

  const set = (id: string, v: Answer) => {
    setError(null)
    setAnswers((a) => ({ ...a, [id]: v }))
  }

  function next() {
    if (!atReview) {
      const answer = q.type === 'photo' || q.type === 'audio' ? (media[q.id] ? 'attached' : null) : answers[q.id]
      const err = validateAnswer(q, answer)
      if (err) return setError(err)
    }
    setError(null)
    setStep((s) => Math.min(s + 1, visible.length))
  }

  async function submit() {
    setSaving(true)
    const gpsQ = visible.find((x) => x.type === 'gps' && answers[x.id])
    const loc = (gpsQ ? answers[gpsQ.id] : await currentFix(8000)) as GpsAnswer | null
    const kept: Answers = {}
    for (const v of visible) if (v.type !== 'note') kept[v.id] = v.type === 'photo' || v.type === 'audio' ? media[v.id]?.name ?? null : answers[v.id] ?? null
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
      media: Object.values(media),
      data: { form_id: form.id, form_version: form.version, form_title: form.title, answers: kept },
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
        <button className="glass-btn sm" aria-label="Close survey (answers are kept as a draft)" onClick={() => onClose(false)}><IconClose /></button>
        <div className="grow">
          <div className="runner-meta"><span>{form.title}</span><span className="tnum">{Math.min(step + 1, visible.length)} / {visible.length}</span></div>
          <div className="runner-bar"><div style={{ transform: `scaleX(${atReview ? 1 : progress})` }} /></div>
        </div>
      </header>

      <main className="runner-body" key={atReview ? 'review' : q.id}>
        {atReview ? (
          <Review form={form} visible={visible} answers={answers} media={media} onEdit={(i) => setStep(i)} />
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
            })} />
          </>
        )}
        {error && <p className="runner-error" role="alert">{error}</p>}
      </main>

      <footer className="runner-foot">
        <button className="btn btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</button>
        {atReview ? (
          <button className="btn btn-lime grow" onClick={() => void submit()} disabled={saving}>{saving ? 'Saving…' : 'Submit response'}</button>
        ) : (
          <button className="btn btn-primary grow" onClick={next}>{step === visible.length - 1 ? 'Review' : q.required ? 'Next' : isAnsweredLocal(q, answers, media) ? 'Next' : 'Skip'}</button>
        )}
      </footer>
    </div>
  )
}

function isAnsweredLocal(q: Question, a: Answers, m: Record<string, LocalMedia>): boolean {
  if (q.type === 'photo' || q.type === 'audio') return !!m[q.id]
  if (q.type === 'note') return true
  const v = a[q.id]
  return v != null && v !== '' && !(Array.isArray(v) && !v.length)
}

interface InputProps {
  q: Question
  value: Answer | undefined
  onChange: (v: Answer) => void
  media?: LocalMedia
  onMedia: (m: LocalMedia | null) => void
}

function QuestionInput({ q, value, onChange, media, onMedia }: InputProps) {
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
      return <AudioInput qid={q.id} media={media} onMedia={onMedia} />
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

function AudioInput({ qid, media, onMedia }: { qid: string; media?: LocalMedia; onMedia: (m: LocalMedia | null) => void }) {
  const [rec, setRec] = useState<{ r: Recording; t0: number } | null>(null)
  const [secs, setSecs] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const url = useBlobUrl(media?.blob)
  useEffect(() => {
    if (!rec) return
    const id = setInterval(() => setSecs(Math.round((Date.now() - rec.t0) / 1000)), 500)
    return () => clearInterval(id)
  }, [rec])
  useEffect(() => () => rec?.r.cancel(), [rec])
  async function toggle() {
    setErr(null)
    if (rec) {
      const blob = await rec.r.stop()
      setRec(null)
      onMedia({ name: `${qid}.${extFor(blob.type)}`, type: blob.type, blob })
      return
    }
    try {
      setSecs(0)
      setRec({ r: await startRecording(), t0: Date.now() })
    } catch {
      setErr('Microphone blocked. Allow it in your browser settings.')
    }
  }
  return (
    <div className="media-box">
      {url && !rec && <audio controls src={url} style={{ width: '100%' }} />}
      <button className={`btn grow ${rec ? 'btn-danger' : 'btn-primary'}`} onClick={() => void toggle()}>
        <IconMic width={20} /> {rec ? `Stop · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : media ? 'Record again' : 'Start recording'}
      </button>
      {err && <p className="small" style={{ color: 'var(--danger)' }}>{err}</p>}
    </div>
  )
}

function Review({ form, visible, answers, media, onEdit }: { form: FormRow; visible: Question[]; answers: Answers; media: Record<string, LocalMedia>; onEdit: (i: number) => void }) {
  const answered = visible.filter((v) => v.type !== 'note' && isAnsweredLocal(v, answers, media)).length
  const total = visible.filter((v) => v.type !== 'note').length
  return (
    <div className="stack" style={{ gap: 12 }}>
      <h2 className="runner-q">Ready to submit</h2>
      <p className="runner-hint">{answered} of {total} answered for “{form.title}”. Tap any answer to change it. Location and time are added automatically.</p>
      <div className="review-list">
        {visible.map((v, i) =>
          v.type === 'note' ? null : (
            <button key={v.id} className="review-item" onClick={() => onEdit(i)}>
              <span className="small muted">{v.label}</span>
              <b>{v.type === 'photo' || v.type === 'audio' ? (media[v.id] ? `${v.type} attached` : '—') : display(answers[v.id])}</b>
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
