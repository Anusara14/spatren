import { useEffect, useRef, useState } from 'react'
import { aiConfig, PROMPT_CARDS, suggestFollowUps, type FollowUp, type Suggestion } from '../lib/ai'
import { db, type LocalRecord } from '../lib/db'
import { extFor, startRecording, type Recording } from '../lib/media'
import { syncNow } from '../lib/sync'
import { currentFix } from '../lib/tracking'
import { IconBack, IconMic } from './icons'

type Stage = 'setup' | 'live'
interface Asked {
  at: number // seconds into the interview
  q: FollowUp
  ai: boolean
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * Open interview: one continuous voice recording (stays on the phone, sent to the laptop later), with prompt cards
 * and optional AI follow-up suggestions. Questions the student marks as asked are saved with their timestamps.
 */
export default function OpenInterview({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const [stage, setStage] = useState<Stage>('setup')
  const [topic, setTopic] = useState('')
  const [participants, setParticipants] = useState('1')
  const [consent, setConsent] = useState(false)
  const [rec, setRec] = useState<Recording | null>(null)
  const started = useRef(0)
  const [elapsed, setElapsed] = useState(0)
  const [asked, setAsked] = useState<Asked[]>([])
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState<string | null>(null)
  const [hasAi, setHasAi] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => void aiConfig().then((c) => setHasAi(!!c)), [])
  useEffect(() => {
    if (!rec) return
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [rec])
  // Leaving the screen mid-interview must not leave the microphone on.
  const recRef = useRef<Recording | null>(null)
  recRef.current = rec
  useEffect(() => () => recRef.current?.cancel(), [])

  async function begin() {
    try {
      const r = await startRecording()
      started.current = Date.now()
      setElapsed(0)
      setRec(r)
      setStage('live')
    } catch {
      onToast('Microphone blocked. Allow it for SPATREN in your phone settings.')
    }
  }

  const mark = (q: FollowUp, ai: boolean) => setAsked((a) => [...a, { at: elapsed, q, ai }])

  async function suggest() {
    if (!rec) return
    setAiBusy(true)
    setAiMsg(null)
    try {
      const cfg = await aiConfig()
      if (!cfg) throw new Error('Add a free AI key in Profile → AI follow-ups (or ask the admin to set a class key).')
      if (!navigator.onLine) throw new Error('No signal. Use the prompt cards below; AI needs internet.')
      const s = await suggestFollowUps(cfg, await rec.snapshot(), topic, [...asked.map((a) => a.q.en), ...(suggestion?.questions.map((q) => q.en) ?? [])])
      setSuggestion(s)
    } catch (e: unknown) {
      setAiMsg(e instanceof Error ? e.message : 'AI suggestion failed.')
    }
    setAiBusy(false)
  }

  async function finish() {
    if (!rec || saving) return
    setSaving(true)
    const blob = await rec.stop()
    setRec(null)
    const fix = await currentFix(8_000)
    const record: LocalRecord = {
      id: crypto.randomUUID(),
      kind: 'interview',
      category: 'Open interview',
      title: topic.trim() || 'Open interview',
      notes: notes.trim(),
      lat: fix?.lat ?? null,
      lng: fix?.lng ?? null,
      accuracy: fix?.accuracy ?? null,
      recorded_at: new Date(started.current).toISOString(),
      media: [{ name: `interview-${started.current}.${extFor(blob.type)}`, type: blob.type, blob }],
      data: { open: true, consent, participants: Number(participants) || 1, audio_seconds: elapsed, topic: topic.trim(), asked: asked.map((a) => ({ at_s: a.at, si: a.q.si, en: a.q.en, ai: a.ai })) },
      synced: 0,
    }
    try {
      await db.records.add(record)
      onToast(`Interview saved (${mmss(elapsed)}). The recording stays on this phone: send it from Collect → Send recordings.`)
      void syncNow()
      onBack()
    } catch (e: unknown) {
      setSaving(false)
      onToast(`Could not save: ${e instanceof Error ? e.message : 'storage error'}. Free up space; the recording is lost if you leave now.`)
    }
  }

  if (stage === 'setup')
    return (
      <div className="stack" style={{ gap: 16 }}>
        <header className="kc-sub">
          <button className="glass-btn sm" aria-label="Back to Collect" onClick={onBack}><IconBack /></button>
          <h1 className="grow">Open interview</h1>
        </header>
        <section className="card stack" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="oi-topic">Topic</label>
            <input id="oi-topic" className="input" placeholder="e.g. Living near the sacred city" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="oi-n">People taking part</label>
            <input id="oi-n" className="input" inputMode="numeric" value={participants} onChange={(e) => setParticipants(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </div>
          <label className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2 }} />
            <span className="small">
              The person agreed to be recorded for this university study{hasAi ? ', and that short parts of the audio may be sent to Google’s AI to suggest follow-up questions' : ''}.
            </span>
          </label>
          <button className="btn btn-lime btn-block" style={{ height: 54 }} disabled={!consent} onClick={() => void begin()}>
            <IconMic width={20} /> Start recording
          </button>
          <p className="small muted">
            {hasAi ? 'AI follow-ups are on: tap Suggest during the interview.' : 'Prompt cards work offline. For AI follow-ups, add a free key in Profile → AI follow-ups.'}
          </p>
        </section>
      </div>
    )

  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card stack oi-live" style={{ gap: 10 }}>
        <div className="row between">
          <span className="row" style={{ gap: 8 }}><span className="dot rec-dot" /> <b className="tnum" style={{ fontSize: 22 }}>{mmss(elapsed)}</b></span>
          <button className="btn btn-danger btn-sm" disabled={saving} onClick={() => void finish()}>{saving ? 'Saving…' : 'Stop & save'}</button>
        </div>
        {topic && <p className="small muted">{topic}</p>}
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <div className="row between">
          <h2 className="section-title" style={{ margin: 0 }}>AI follow-ups</h2>
          <button className="btn btn-lime btn-sm" disabled={aiBusy || elapsed < 10} onClick={() => void suggest()}>{aiBusy ? 'Listening…' : 'Suggest'}</button>
        </div>
        {aiMsg && <p className="small" style={{ color: 'var(--danger)' }}>{aiMsg}</p>}
        {!suggestion && !aiMsg && <p className="small muted">After the person has talked for a bit, tap Suggest. It listens to the last 2 minutes and offers 3 questions.</p>}
        {suggestion?.summary && <p className="small"><b>They said:</b> {suggestion.summary}</p>}
        {suggestion?.questions.map((q) => <QuestionCard key={q.en} q={q} done={asked.some((a) => a.q.en === q.en)} onAsk={() => mark(q, true)} />)}
      </section>

      <section className="card stack" style={{ gap: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Prompt cards</h2>
        {PROMPT_CARDS.map((q) => <QuestionCard key={q.en} q={q} done={asked.some((a) => a.q.en === q.en)} onAsk={() => mark(q, false)} />)}
      </section>

      <section className="card stack" style={{ gap: 8 }}>
        <label className="section-title" htmlFor="oi-notes" style={{ margin: 0 }}>Notes</label>
        <textarea id="oi-notes" className="input" rows={3} placeholder="Key points, names of places, things to check later" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </section>
    </div>
  )
}

function QuestionCard({ q, done, onAsk }: { q: FollowUp; done: boolean; onAsk: () => void }) {
  return (
    <button type="button" className={`oi-q ${done ? 'done' : ''}`} onClick={onAsk} aria-pressed={done}>
      <span className="oi-si">{q.si}</span>
      {q.si !== q.en && <span className="oi-en">{q.en}</span>}
      <span className="oi-tag">{done ? 'Asked' : 'Tap when asked'}</span>
    </button>
  )
}
