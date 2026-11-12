import { save } from '@tauri-apps/plugin-dialog'
import { useEffect, useRef, useState } from 'react'
import * as api from './lib/api'
import { aiKey, translateLines } from './lib/ai'
import { fullText, mergeWithNext, splitSegment, wordErrorRate, type Code } from './lib/analysis'
import { clock, speakerName, titleOf, transcriptText, who, type Item, type Segment, type Speaker, type Transcript } from './lib/model'

interface Props {
  item: Item
  transcript: Transcript | null
  codes: Code[]
  busy: boolean
  seekTo: { ms: number; n: number } | null
  onTranscribe: () => Promise<void>
  onEdit: (t: Transcript) => void
  onStatus: (text: string, error?: boolean) => void
}

const NEXT_SPEAKER: Record<string, Speaker | undefined> = { none: 'R', R: 'I', I: undefined }

/** One recording: details, player with asked-question markers, and the editable, codable transcript. */
export default function InterviewView({ item, transcript, codes, busy, seekTo, onTranscribe, onEdit, onStatus }: Props) {
  const audio = useRef<HTMLAudioElement>(null)
  const [now, setNow] = useState(0)
  const [working, setWorking] = useState(false)
  const [translating, setTranslating] = useState<string | null>(null)
  const [draft, setDraft] = useState<Segment[] | null>(transcript?.segments ?? null)
  const r = item.record
  const asked = r.interview?.asked ?? []
  const codeById = new Map(codes.map((c) => [c.id, c]))

  useEffect(() => setDraft(transcript?.segments ?? null), [transcript])
  // Edits save shortly after typing stops, and immediately if the student leaves this recording before that.
  const pending = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!draft || !transcript || draft === transcript.segments) return
    const flush = () => {
      pending.current = null
      onEdit({ ...transcript, segments: draft, edited_at: new Date().toISOString() })
    }
    pending.current = flush
    const t = setTimeout(flush, 700)
    return () => clearTimeout(t)
  }, [draft, transcript, onEdit])
  useEffect(() => () => pending.current?.(), [])

  const seek = (ms: number) => {
    if (!audio.current) return
    audio.current.currentTime = ms / 1000
    void audio.current.play()
  }
  useEffect(() => {
    if (seekTo) seek(seekTo.ms)
  }, [seekTo])

  const activeIndex = draft ? draft.findIndex((s) => now >= s.start && now < s.end) : -1

  // Follow along: while the audio plays, keep the spoken line in view (unless the student is typing in one).
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (activeIndex < 0 || audio.current?.paused || document.activeElement?.tagName === 'TEXTAREA') return
    listRef.current?.querySelector(`[data-seg="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIndex])

  // Transcription keys that work even while typing: Ctrl+Space play/pause, Alt+Left/Right jump 5 s.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = audio.current
      if (!a) return
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault()
        if (a.paused) void a.play()
        else a.pause()
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        a.currentTime = Math.max(0, a.currentTime + (e.key === 'ArrowLeft' ? -5 : 5))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const patch = (i: number, p: Partial<Segment>) => setDraft((d) => d && d.map((x, j) => (j === i ? { ...x, ...p } : x)))

  async function run() {
    setWorking(true)
    await onTranscribe()
    setWorking(false)
  }

  async function translate() {
    const key = aiKey()
    if (!key || !draft) return onStatus('Add your Gemini key in Settings to translate.', true)
    const todo = draft.filter((s) => !s.en && s.text)
    if (!todo.length) return onStatus('Every line already has an English translation.')
    try {
      setTranslating(`0/${todo.length}`)
      const en = await translateLines(key, todo.map((s) => s.text), (n) => setTranslating(`${n}/${todo.length}`))
      // Match by time and text, not position: lines may have been split or joined while Gemini was working.
      const byLine = new Map(todo.map((s, k) => [`${s.start}|${s.text}`, en[k]]))
      setDraft((d) => d && d.map((s) => (!s.en && byLine.has(`${s.start}|${s.text}`) ? { ...s, en: byLine.get(`${s.start}|${s.text}`) } : s)))
      onStatus('Translated. English is a draft: check it against the Sinhala.')
    } catch (e) {
      onStatus(String(e instanceof Error ? e.message : e), true)
    } finally {
      setTranslating(null)
    }
  }

  async function exportTxt() {
    if (!transcript || !draft) return
    const name = `${titleOf(r).replace(/[^\p{L}\p{N} _-]+/gu, '').slice(0, 50) || 'interview'} - ${who(item.collector)}.txt`
    const path = await save({ defaultPath: name, filters: [{ name: 'Text', extensions: ['txt'] }] })
    if (!path) return
    try {
      await api.saveText(path, transcriptText(item, { ...transcript, segments: draft }))
      onStatus(`Saved ${path}`)
    } catch (e) {
      onStatus(`Couldn't save: ${String(e)}`, true)
    }
  }

  const corrected = transcript?.machine_text && transcript.edited_at && draft ? wordErrorRate(transcript.machine_text, fullText({ ...transcript, segments: draft })) : null

  return (
    <div className="d-view">
      <header className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">{r.interview?.open ? 'Open interview' : r.kind}</span>
        <h1>{titleOf(r)}</h1>
        <p className="small muted">
          {who(item.collector)}{item.collector.index_no ? ` (${item.collector.index_no})` : ''} · {item.collector.group} {item.collector.subgroup} ·{' '}
          {new Date(r.recorded_at).toLocaleString()}
          {r.location ? ` · ${r.location.lat.toFixed(5)}, ${r.location.lng.toFixed(5)}` : ''}
          {r.interview?.participants ? ` · ${r.interview.participants} participant${r.interview.participants === 1 ? '' : 's'}` : ''}
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
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Transcript</h2>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {transcript && <button className="btn btn-ghost btn-sm" disabled={!!translating} onClick={() => void translate()}>{translating ? `Translating ${translating}…` : 'Translate to English'}</button>}
            {transcript && <button className="btn btn-ghost btn-sm" onClick={() => void exportTxt()}>Export TXT</button>}
            <button className="btn btn-lime btn-sm" disabled={working || busy} onClick={() => void run()}>
              {working ? 'Transcribing…' : transcript ? 'Transcribe again' : 'Transcribe'}
            </button>
          </div>
        </div>
        {!draft && <p className="small muted">Runs on this computer with the Sinhala Whisper model; nothing is uploaded. The result is a draft: listen and correct it here.</p>}
        {draft && !draft.length && <p className="small muted">No speech was found in this recording.</p>}
        {draft && draft.length > 0 && (
          <p className="tiny muted">
            Click a time to listen · <kbd>Ctrl</kbd>+<kbd>Space</kbd> play/pause · <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> jump 5 s · speaker button cycles Respondent → Interviewer · ★ saves a quote · <kbd>Enter</kbd> splits a line
          </p>
        )}
        <div ref={listRef} className="d-segs">
        {draft?.map((s, i) => (
          <div key={i} data-seg={i} className={`d-seg ${i === activeIndex ? 'active' : ''} ${s.star ? 'starred' : ''}`}>
            <div className="d-seg-side">
              <button className="d-time" onClick={() => seek(s.start)}>{clock(s.start)}</button>
              <button className={`d-spk ${s.speaker ?? ''}`} aria-label={`Speaker: ${speakerName(s.speaker) || 'not set'}. Click to change.`} onClick={() => patch(i, { speaker: NEXT_SPEAKER[s.speaker ?? 'none'] })}>
                {s.speaker === 'I' ? 'Int' : s.speaker === 'R' ? 'Resp' : '–'}
              </button>
              <button className={`d-star ${s.star ? 'on' : ''}`} aria-pressed={!!s.star} title="Save to quote bank" onClick={() => patch(i, { star: !s.star })}>★</button>
            </div>
            <div className="d-seg-main">
              <textarea
                className="d-text"
                rows={Math.max(1, Math.ceil(s.text.length / 80))}
                value={s.text}
                onChange={(e) => patch(i, { text: e.target.value })}
                onKeyDown={(e) => {
                  const at = e.currentTarget.selectionStart
                  if (e.key === 'Enter' && !e.shiftKey && at > 0 && at < s.text.length) {
                    e.preventDefault()
                    setDraft((d) => d && [...d.slice(0, i), ...splitSegment(d[i], at), ...d.slice(i + 1)])
                  }
                }}
              />
              {s.en && <p className="d-en">{s.en}</p>}
              <div className="d-codes">
                {(s.codes ?? []).map((id) => {
                  const c = codeById.get(id)
                  return (
                    <button key={id} className="d-code" style={{ borderColor: c?.color }} title="Remove code" onClick={() => patch(i, { codes: s.codes?.filter((x) => x !== id) })}>
                      <i style={{ background: c?.color }} /> {c?.name ?? 'Deleted code'} ×
                    </button>
                  )
                })}
                {codes.length > 0 && (
                  <select className="d-code-add" value="" aria-label="Add a code" onChange={(e) => e.target.value && patch(i, { codes: [...(s.codes ?? []), e.target.value] })}>
                    <option value="">+ code</option>
                    {codes.filter((c) => !s.codes?.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                {i < draft.length - 1 && <button className="link-btn d-join" onClick={() => setDraft((d) => d && mergeWithNext(d, i))}>Join with next line</button>}
              </div>
            </div>
          </div>
        ))}
        </div>
        {transcript?.edited_at && (
          <p className="tiny muted">
            Edited {new Date(transcript.edited_at).toLocaleString()}
            {corrected != null ? ` · ${Math.round(corrected * 100)}% of words changed from the machine draft` : ''}
          </p>
        )}
      </section>
    </div>
  )
}
