import { save } from '@tauri-apps/plugin-dialog'
import { useEffect, useRef, useState } from 'react'
import * as api from './lib/api'
import { clock, titleOf, transcriptText, who, type Item, type Segment, type Transcript } from './lib/model'

interface Props {
  item: Item
  transcript: Transcript | null
  busy: boolean
  onTranscribe: () => Promise<void>
  onEdit: (t: Transcript) => void
  onStatus: (text: string, error?: boolean) => void
}

/** One recording: details, player with asked-question markers, and the editable transcript (click a time to hear it). */
export default function InterviewView({ item, transcript, busy, onTranscribe, onEdit, onStatus }: Props) {
  const audio = useRef<HTMLAudioElement>(null)
  const [now, setNow] = useState(0)
  const [working, setWorking] = useState(false)
  const [draft, setDraft] = useState<Segment[] | null>(transcript?.segments ?? null)
  const r = item.record
  const asked = r.interview?.asked ?? []

  useEffect(() => setDraft(transcript?.segments ?? null), [transcript])
  // Edits save shortly after typing stops.
  useEffect(() => {
    if (!draft || !transcript || draft === transcript.segments) return
    const t = setTimeout(() => onEdit({ ...transcript, segments: draft, edited_at: new Date().toISOString() }), 700)
    return () => clearTimeout(t)
  }, [draft, transcript, onEdit])

  const seek = (ms: number) => {
    if (!audio.current) return
    audio.current.currentTime = ms / 1000
    void audio.current.play()
  }
  const activeIndex = draft ? draft.findIndex((s) => now >= s.start && now < s.end) : -1

  async function run() {
    setWorking(true)
    await onTranscribe()
    setWorking(false)
  }

  async function exportTxt() {
    if (!transcript || !draft) return
    const name = `${titleOf(r).replace(/[^\p{L}\p{N} _-]+/gu, '').slice(0, 50) || 'interview'} - ${who(item.collector)}.txt`
    const path = await save({ defaultPath: name, filters: [{ name: 'Text', extensions: ['txt'] }] })
    if (!path) return
    await api.saveText(path, transcriptText(item, { ...transcript, segments: draft }))
    onStatus(`Saved ${path}`)
  }

  return (
    <div className="d-view">
      <header className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">{r.interview?.open ? 'Open interview' : r.kind}</span>
        <h1>{titleOf(r)}</h1>
        <p className="small muted">
          {who(item.collector)}{item.collector.index_no ? ` (${item.collector.index_no})` : ''} · {item.collector.group} {item.collector.subgroup} ·{' '}
          {new Date(r.recorded_at).toLocaleString()}
          {r.location ? ` · ${r.location.lat.toFixed(5)}, ${r.location.lng.toFixed(5)}` : ''}
          {r.consent === false ? ' · no consent recorded' : ''}
        </p>
        {r.notes && <p className="small">Notes: {r.notes}</p>}
      </header>

      <section className="card stack" style={{ gap: 10 }}>
        <audio ref={audio} controls preload="metadata" src={api.audioUrl(item.dir, item.audioFile)} onTimeUpdate={(e) => setNow(e.currentTarget.currentTime * 1000)} style={{ width: '100%' }} />
        {asked.length > 0 && (
          <div className="d-asked">
            <span className="tiny muted">Questions asked (click to jump):</span>
            {asked.map((a, i) => (
              <button key={i} className="chip" title={a.en} onClick={() => seek(a.at_s * 1000)}>{clock(a.at_s * 1000)} · {a.si.length > 40 ? `${a.si.slice(0, 40)}…` : a.si}</button>
            ))}
          </div>
        )}
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <div className="row between">
          <h2 className="section-title" style={{ margin: 0 }}>Transcript (Sinhala)</h2>
          <div className="row">
            {transcript && <button className="btn btn-ghost btn-sm" onClick={() => void exportTxt()}>Export TXT</button>}
            <button className="btn btn-lime btn-sm" disabled={working || busy} onClick={() => void run()}>
              {working ? 'Transcribing…' : transcript ? 'Transcribe again' : 'Transcribe'}
            </button>
          </div>
        </div>
        {!draft && <p className="small muted">Runs on this computer with the Sinhala Whisper model; nothing is uploaded. The result is a draft: listen and correct it here.</p>}
        {draft && !draft.length && <p className="small muted">No speech was found in this recording.</p>}
        {draft?.map((s, i) => (
          <div key={i} className={`d-seg ${i === activeIndex ? 'active' : ''}`}>
            <button className="d-time" onClick={() => seek(s.start)}>{clock(s.start)}</button>
            <textarea className="d-text" rows={Math.max(1, Math.ceil(s.text.length / 70))} value={s.text}
              onChange={(e) => setDraft((d) => d && d.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          </div>
        ))}
        {transcript?.edited_at && <p className="tiny muted">Edited {new Date(transcript.edited_at).toLocaleString()}</p>}
      </section>
    </div>
  )
}
