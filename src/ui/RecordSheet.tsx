import { useEffect, useMemo, useState } from 'react'
import { db, type LocalRecord } from '../lib/db'
import { RATINGS } from '../lib/experience'
import { flatQuestions, type FormDef } from '../lib/forms'
import { clock, mapsLink } from '../lib/geo'
import { syncNow } from '../lib/sync'
import { mmss } from '../lib/useRecorder'
import { IconClose } from './icons'

type AnswerValue = string | number | boolean | string[] | { lat: number; lng: number; accuracy?: number } | null

/** Question labels for a survey's answers, from the forms cached on this phone. */
function questionLabels(formId: unknown): Record<string, { label: string; type: string }> {
  try {
    const forms = JSON.parse(localStorage.getItem('spatren.forms') ?? '[]') as { id: string; definition: FormDef }[]
    const local = JSON.parse(localStorage.getItem('spatren.localForms') ?? '[]') as { id: string; definition: FormDef }[]
    const f = [...forms, ...local].find((x) => x.id === formId)
    return f ? Object.fromEntries(flatQuestions(f.definition).map((q) => [q.id, { label: q.label, type: q.type }])) : {}
  } catch {
    return {}
  }
}

const KIND_LABEL: Record<LocalRecord['kind'], string> = {
  observation: 'Observation', interview: 'Interview', note: 'Note', survey: 'Survey', experience: 'Experience',
}

/**
 * Look back at anything saved on this phone: photos, every recording (open interviews included), the questions
 * asked, survey answers. Text, notes, answers and an experience's rating can be corrected; the change is sent again.
 */
export default function RecordSheet({ record, onClose, onToast }: { record: LocalRecord; onClose: () => void; onToast: (m: string) => void }) {
  const [title, setTitle] = useState(record.title)
  const [notes, setNotes] = useState(record.notes)
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => ({ ...((record.data.answers ?? {}) as Record<string, AnswerValue>) }))
  const [rating, setRating] = useState<number | null>((record.data.rating as number | undefined) ?? null)
  const [saving, setSaving] = useState(false)
  const labels = useMemo(() => questionLabels(record.data.form_id), [record])
  const photos = record.media.filter((m) => m.type.startsWith('image'))
  const audios = record.media.filter((m) => m.type.startsWith('audio'))
  const asked = (record.data.asked ?? []) as { at_s: number; si: string; en: string }[]
  const isSurvey = record.kind === 'survey'
  const isExp = record.kind === 'experience'

  const changed =
    title !== record.title || notes !== record.notes || rating !== ((record.data.rating as number | undefined) ?? null) ||
    JSON.stringify(answers) !== JSON.stringify(record.data.answers ?? {})

  async function save() {
    setSaving(true)
    try {
      const data = { ...record.data, ...(isSurvey ? { answers } : {}), ...(isExp ? { rating } : {}), edited_at: new Date().toISOString() }
      await db.records.update(record.id, { title: title.trim(), notes: notes.trim(), data, synced: 0 })
      void syncNow()
      onToast(navigator.onLine ? 'Saved. Sending the change…' : 'Saved on this phone. The change is sent when you are online.')
      onClose()
    } catch (e) {
      onToast(`Couldn't save: ${e instanceof Error ? e.message : 'storage error'}.`)
      setSaving(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet stack record-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Saved record">
        <div className="row between">
          <div>
            <span className="eyebrow">{isSurvey ? String(record.data.form_title ?? 'Survey') : KIND_LABEL[record.kind]}</span>
            <p className="small muted tnum">
              {new Date(record.recorded_at).toLocaleDateString([], { day: 'numeric', month: 'short' })} {clock(record.recorded_at)}
              {record.lat != null ? ' · located' : ' · no location'} · {record.synced ? 'Uploaded' : 'On this phone'}
            </p>
          </div>
          <button type="button" className="glass-btn sm" aria-label="Close" onClick={onClose}><IconClose /></button>
        </div>

        {audios.length > 0 && (
          <section className="stack" style={{ gap: 6 }}>
            <b className="small">Recording{audios.length > 1 ? `s (${audios.length} parts)` : ''}{record.data.audio_seconds ? ` · ${mmss(Number(record.data.audio_seconds))}` : ''}</b>
            {audios.map((a) => <BlobAudio key={a.name} blob={a.blob} />)}
          </section>
        )}
        {asked.length > 0 && (
          <details>
            <summary className="small">Questions asked ({asked.length})</summary>
            <ul className="small asked-list">{asked.map((a, i) => <li key={i}><span className="tnum muted">{mmss(a.at_s)}</span> {a.si}{a.en && a.en !== a.si ? <em className="muted"> · {a.en}</em> : null}</li>)}</ul>
          </details>
        )}
        {photos.length > 0 && <div className="exp-photos">{photos.map((p) => <BlobImage key={p.name} blob={p.blob} />)}</div>}

        {isExp && (
          <div className="rating-row" role="radiogroup" aria-label="Rating">
            {RATINGS.map((r) => (
              <button type="button" key={r.value} role="radio" aria-checked={rating === r.value} className={`rating-btn ${rating === r.value ? 'on' : ''}`}
                style={{ ['--r' as string]: r.color }} onClick={() => setRating(r.value)}>
                <span aria-hidden="true">{r.emoji}</span>{r.label}
              </button>
            ))}
          </div>
        )}

        <div className="field">
          <label htmlFor="rs-title">{isExp ? 'Place' : 'Title'}</label>
          <input id="rs-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rs-notes">Notes</label>
          <textarea id="rs-notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {isSurvey && Object.keys(answers).length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <b className="small">Answers</b>
            {Object.entries(answers).map(([qid, v]) => {
              const meta = labels[qid]
              const label = meta?.label ?? qid
              const editable = v == null || typeof v === 'string' || typeof v === 'number'
              const media = meta?.type === 'photo' || meta?.type === 'audio'
              return (
                <div key={qid} className="field">
                  <label htmlFor={`rs-${qid}`}>{label}</label>
                  {editable && !media ? (
                    <input id={`rs-${qid}`} className="input" value={v == null ? '' : String(v)}
                      onChange={(e) => setAnswers((a) => ({ ...a, [qid]: typeof v === 'number' && e.target.value !== '' && !Number.isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value }))} />
                  ) : Array.isArray(v) ? (
                    <input id={`rs-${qid}`} className="input" value={v.join(', ')} onChange={(e) => setAnswers((a) => ({ ...a, [qid]: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) }))} />
                  ) : (
                    <p className="small muted">{media ? (v ? 'File attached above' : '—') : typeof v === 'object' && v && 'lat' in v ? `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}` : String(v)}</p>
                  )}
                </div>
              )
            })}
          </section>
        )}

        {record.lat != null && <a className="btn btn-ghost btn-block" href={mapsLink(record.lat, record.lng!)} target="_blank" rel="noreferrer">Open the location</a>}
        <button type="button" className="btn btn-lime btn-block" disabled={!changed || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : changed ? 'Save changes' : 'No changes'}
        </button>
      </div>
    </div>
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
function BlobAudio({ blob }: { blob: Blob }) {
  const url = useBlobUrl(blob)
  return url ? <audio controls preload="metadata" src={url} style={{ width: '100%' }} /> : null
}
function BlobImage({ blob }: { blob: Blob }) {
  const url = useBlobUrl(blob)
  return url ? <img src={url} alt="" loading="lazy" /> : null
}
