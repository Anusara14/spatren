import { useEffect, useMemo, useRef, useState } from 'react'
import { aiConfig, PROMPT_CARDS, suggestFollowUps, type FollowUp, type Suggestion } from '../lib/ai'
import { db, type LocalRecord } from '../lib/db'
import { extFor, startRecording, type Recording } from '../lib/media'
import { questionSets, TOPICS } from '../lib/questions'
import type { Profile } from '../lib/supabase'
import { syncNow } from '../lib/sync'
import { currentFix } from '../lib/tracking'
import { IconBack, IconMic } from './icons'

interface Asked {
  at: number // seconds into the interview
  si: string
  en: string
  ai: boolean
}

/** Survives a crash: the interview's details live here while recording; the audio lives in db.audioChunks. */
interface LiveMeta {
  session: string
  started: number
  topic: string
  participants: number
  consent: boolean
  asked: Asked[]
  notes: string
}
const LIVE_KEY = 'spatren.oi.live'
const readLive = (): LiveMeta | null => {
  try {
    return JSON.parse(localStorage.getItem(LIVE_KEY) ?? 'null') as LiveMeta | null
  } catch {
    return null
  }
}
const writeLive = (m: LiveMeta | null) => {
  try {
    if (m) localStorage.setItem(LIVE_KEY, JSON.stringify(m))
    else localStorage.removeItem(LIVE_KEY)
  } catch {
    /* storage full: the audio is still saved in IndexedDB */
  }
}
const myProfile = (): Profile | null => {
  try {
    return JSON.parse(localStorage.getItem('spatren.profile') ?? 'null') as Profile | null
  } catch {
    return null
  }
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

async function saveInterview(meta: LiveMeta, audio: Blob, seconds: number, recovered: boolean): Promise<void> {
  const fix = await currentFix(8_000)
  const record: LocalRecord = {
    id: crypto.randomUUID(),
    kind: 'interview',
    category: 'Open interview',
    title: meta.topic.trim() || 'Open interview',
    notes: meta.notes.trim(),
    lat: fix?.lat ?? null,
    lng: fix?.lng ?? null,
    accuracy: fix?.accuracy ?? null,
    recorded_at: new Date(meta.started).toISOString(),
    media: [{ name: `interview-${meta.started}.${extFor(audio.type)}`, type: audio.type || 'audio/webm', blob: audio }],
    data: {
      open: true, consent: meta.consent, participants: meta.participants || 1, audio_seconds: seconds, topic: meta.topic.trim(),
      asked: meta.asked.map((a) => ({ at_s: a.at, si: a.si, en: a.en, ai: a.ai })), ...(recovered ? { recovered: true } : {}),
    },
    synced: 0,
  }
  await db.records.add(record)
  await db.audioChunks.where('session').equals(meta.session).delete()
  writeLive(null)
  void syncNow()
}

/**
 * Open interview: one continuous voice recording (kept on the phone; sent to the laptop later), question sets for
 * the student's theme, elective and Anuradhapura, neutral probes, and optional AI follow-ups. Works fully offline
 * except AI. Audio is written to disk every 5 s, so an interrupted interview can be recovered on the next visit.
 */
export default function OpenInterview({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const profile = useMemo(myProfile, [])
  const theme = profile?.subgroup ?? null
  const sets = useMemo(() => questionSets(theme, profile?.elective ?? null, PROMPT_CARDS), [theme, profile?.elective])

  const [meta, setMeta] = useState<LiveMeta>(() => ({ session: '', started: 0, topic: '', participants: 1, consent: false, asked: [], notes: '' }))
  const [rec, setRec] = useState<Recording | null>(null)
  const [starting, setStarting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [setId, setSetId] = useState(sets[0].id)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState<string | null>(null)
  const [hasAi, setHasAi] = useState(false)
  const [leftover, setLeftover] = useState<{ meta: LiveMeta; pieces: number } | null>(null)

  const live = rec !== null
  const recRef = useRef<Recording | null>(null)
  recRef.current = rec

  useEffect(() => void aiConfig().then((c) => setHasAi(!!c)), [])
  // An interview cut off by a crash, a call or a closed app: offer to save what was recorded.
  useEffect(() => {
    const m = readLive()
    if (!m) return
    void db.audioChunks.where('session').equals(m.session).count().then((n) => (n ? setLeftover({ meta: m, pieces: n }) : writeLive(null)))
  }, [])
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setElapsed(Math.round((Date.now() - meta.started) / 1000)), 1000)
    const warn = (e: BeforeUnloadEvent) => e.preventDefault() // web: refresh/close asks first
    addEventListener('beforeunload', warn)
    return () => {
      clearInterval(t)
      removeEventListener('beforeunload', warn)
    }
  }, [live, meta.started])
  useEffect(() => {
    if (live) writeLive(meta)
  }, [live, meta])
  // Leaving the screen any other way still stops the microphone (the saved pieces remain recoverable).
  useEffect(() => () => recRef.current?.cancel(), [])

  const set = (patch: Partial<LiveMeta>) => setMeta((m) => ({ ...m, ...patch }))

  async function begin() {
    if (starting || live) return
    setStarting(true)
    const session = crypto.randomUUID()
    try {
      const r = await startRecording((piece) => void db.audioChunks.add({ session, blob: piece }).catch(() => undefined))
      const m = { ...meta, session, started: Date.now(), asked: [], notes: '' }
      setMeta(m)
      writeLive(m)
      setElapsed(0)
      setRec(r)
    } catch {
      onToast('Microphone blocked. Allow it for SPATREN in your phone settings, then try again.')
    }
    setStarting(false)
  }

  const isAsked = (q: FollowUp) => meta.asked.some((a) => a.en === q.en)
  const toggleAsked = (q: FollowUp, ai: boolean) =>
    set({ asked: isAsked(q) ? meta.asked.filter((a) => a.en !== q.en) : [...meta.asked, { at: elapsed, si: q.si, en: q.en, ai }] })

  async function suggest() {
    if (!rec || aiBusy) return
    setAiBusy(true)
    setAiMsg(null)
    try {
      if (!navigator.onLine) throw new Error('No signal. Use the question cards; AI needs internet.')
      const cfg = await aiConfig()
      if (!cfg) throw new Error('Add a free AI key in Profile → AI follow-ups (or ask the admin for a class key).')
      const earlier = [...meta.asked.map((a) => a.en), ...(suggestion?.questions.map((q) => q.en) ?? [])]
      setSuggestion(await suggestFollowUps(cfg, await rec.snapshot(25), meta.topic, earlier, [theme, profile?.elective].filter(Boolean).join(', ')))
    } catch (e: unknown) {
      setAiMsg(e instanceof Error ? e.message : 'AI suggestion failed. Use the question cards.')
    }
    setAiBusy(false)
  }

  async function finish() {
    if (!rec || saving) return
    setSaving(true)
    let audio: Blob
    try {
      audio = await rec.stop()
    } catch {
      const pieces = await db.audioChunks.where('session').equals(meta.session).sortBy('id')
      audio = new Blob(pieces.map((p) => p.blob), { type: pieces[0]?.blob.type || 'audio/webm' })
    }
    setRec(null)
    try {
      await saveInterview(meta, audio, elapsed, false)
      onToast(`Interview saved (${mmss(elapsed)}). The recording stays on this phone; send it from Collect → Send recordings.`)
      onBack()
    } catch (e: unknown) {
      setSaving(false)
      onToast(`Could not save: ${e instanceof Error ? e.message : 'storage error'}. Free up space; the audio is kept and you can recover it here.`)
    }
  }

  async function recover(keep: boolean) {
    if (!leftover) return
    const { meta: m } = leftover
    if (!keep) {
      if (!confirm('Delete the unfinished interview recording? This cannot be undone.')) return
      await db.audioChunks.where('session').equals(m.session).delete()
      writeLive(null)
      setLeftover(null)
      return
    }
    const pieces = await db.audioChunks.where('session').equals(m.session).sortBy('id')
    const audio = new Blob(pieces.map((p) => p.blob), { type: pieces[0]?.blob.type || 'audio/webm' })
    try {
      await saveInterview(m, audio, pieces.length * 5, true)
      setLeftover(null)
      onToast('Unfinished interview saved. Find it under Send recordings.')
    } catch (e: unknown) {
      onToast(`Could not save: ${e instanceof Error ? e.message : 'storage error'}.`)
    }
  }

  if (!live)
    return (
      <div className="stack" style={{ gap: 16 }}>
        <header className="kc-sub">
          <button className="glass-btn sm" aria-label="Back to Collect" onClick={onBack} disabled={saving}><IconBack /></button>
          <h1 className="grow">Open interview</h1>
        </header>

        {leftover && (
          <section className="card stack oi-recover" style={{ gap: 10 }}>
            <b>Unfinished interview found</b>
            <p className="small">“{leftover.meta.topic || 'Open interview'}”, about {mmss(leftover.pieces * 5)} recorded, was cut off. Save it so the audio isn't lost.</p>
            <div className="row">
              <button className="btn btn-lime btn-sm grow" onClick={() => void recover(true)}>Save it</button>
              <button className="btn btn-ghost btn-sm" onClick={() => void recover(false)}>Delete</button>
            </div>
          </section>
        )}

        <section className="card stack" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="oi-topic">Topic</label>
            <input id="oi-topic" className="input" placeholder="What is this interview about?" value={meta.topic} onChange={(e) => set({ topic: e.target.value })} maxLength={120} />
            <div className="oi-chips">
              {(TOPICS[theme ?? ''] ?? ['Living here', 'Changes over time', 'Heritage & daily life']).map((t) => (
                <button key={t} type="button" className={`chip ${meta.topic === t ? 'chip-lime' : ''}`} onClick={() => set({ topic: t })}>{t}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="oi-n">People taking part</label>
            <input id="oi-n" className="input" inputMode="numeric" value={meta.participants || ''} onChange={(e) => set({ participants: Number(e.target.value.replace(/\D/g, '').slice(0, 2)) || 0 })} />
          </div>
          <label className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            <input type="checkbox" checked={meta.consent} onChange={(e) => set({ consent: e.target.checked })} style={{ width: 22, height: 22, marginTop: 2, flex: 'none' }} />
            <span className="small">
              The person agreed to be recorded for this university study{hasAi ? ', and that short parts of the audio may be sent to Google’s AI to suggest follow-up questions' : ''}.
            </span>
          </label>
          <button className="btn btn-lime btn-block" style={{ height: 54 }} disabled={!meta.consent || starting || !!leftover} onClick={() => void begin()}>
            <IconMic width={20} /> {starting ? 'Starting…' : 'Start recording'}
          </button>
          <p className="small muted">
            {theme ? `Questions for ${theme}${profile?.elective ? ` and ${profile.elective}` : ''} are ready, plus Anuradhapura-wide ones. ` : ''}
            Works without signal. {hasAi ? 'AI follow-ups need internet.' : 'For AI follow-ups, add a free key in Profile → AI follow-ups.'}
          </p>
        </section>
      </div>
    )

  const shown = sets.find((s) => s.id === setId) ?? sets[0]
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card stack oi-live" style={{ gap: 6 }}>
        <div className="row between">
          <span className="row" style={{ gap: 8 }}><span className="dot rec-dot" /><b className="tnum" style={{ fontSize: 22 }}>{mmss(elapsed)}</b></span>
          <button className="btn btn-danger btn-sm" disabled={saving} onClick={() => void finish()}>{saving ? 'Saving…' : 'Stop & save'}</button>
        </div>
        <p className="small muted">{meta.topic || 'Open interview'} · {meta.asked.length} asked · keep this screen open</p>
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <div className="row between">
          <h2 className="section-title" style={{ margin: 0 }}>AI follow-ups</h2>
          <button className="btn btn-lime btn-sm" disabled={aiBusy || elapsed < 10} onClick={() => void suggest()}>{aiBusy ? 'Listening…' : 'Suggest'}</button>
        </div>
        {aiMsg && <p className="small" style={{ color: 'var(--danger)' }}>{aiMsg}</p>}
        {!suggestion && !aiMsg && <p className="small muted">Once they've talked for a bit, tap Suggest: it listens to the last 2 minutes and offers 3 questions.</p>}
        {suggestion?.summary && <p className="small"><b>They said:</b> {suggestion.summary}</p>}
        {suggestion?.questions.map((q) => <QuestionCard key={q.en} q={q} done={isAsked(q)} onTap={() => toggleAsked(q, true)} />)}
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <div className="oi-chips" role="tablist" aria-label="Question sets">
          {sets.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === shown.id} className={`chip ${s.id === shown.id ? 'chip-lime' : ''}`} onClick={() => setSetId(s.id)}>{s.label}</button>
          ))}
        </div>
        {shown.questions.map((q) => <QuestionCard key={q.en} q={q} done={isAsked(q)} onTap={() => toggleAsked(q, false)} />)}
      </section>

      <section className="card stack" style={{ gap: 8 }}>
        <label className="section-title" htmlFor="oi-notes" style={{ margin: 0 }}>Notes</label>
        <textarea id="oi-notes" className="input" rows={3} placeholder="Key points, place names, things to check later" value={meta.notes} onChange={(e) => set({ notes: e.target.value })} />
      </section>
    </div>
  )
}

function QuestionCard({ q, done, onTap }: { q: FollowUp; done: boolean; onTap: () => void }) {
  return (
    <button type="button" className={`oi-q ${done ? 'done' : ''}`} onClick={onTap} aria-pressed={done}>
      <span className="oi-si">{q.si}</span>
      {q.si !== q.en && <span className="oi-en">{q.en}</span>}
      <span className="oi-tag">{done ? 'Asked · tap to undo' : 'Tap when asked'}</span>
    </button>
  )
}
