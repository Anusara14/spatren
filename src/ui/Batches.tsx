import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { friendlyError, supabase } from '../lib/supabase'
import RosterUpload from './RosterUpload'

interface BatchRow {
  id: string
  name: string
  place: string | null
  students: number
  joined: number
  admins: number
  leaders: number
  created_at: string
}

/**
 * Platform owner only: one batch per class (e.g. this year's L2S4, next year's juniors). Each batch has its own
 * class list, groups, leaders, admins, forms, meeting pins and experience map; batches never see each other's data.
 */
export default function Batches() {
  const [rows, setRows] = useState<BatchRow[] | null>(null)
  const [name, setName] = useState('')
  const [place, setPlace] = useState('')
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_batches')
    if (error) {
      setRows([])
      return setErr(friendlyError(error, 'load the batches'))
    }
    setRows((data ?? []) as BatchRow[])
    const n = await supabase.from('batch_notes').select('batch_id,note')
    setNotes(Object.fromEntries(((n.data ?? []) as { batch_id: string; note: string }[]).map((x) => [x.batch_id, x.note])))
  }, [])

  /** Private label, e.g. "Juniors": stored apart from the batch so its students never see it. */
  async function saveNote(id: string, note: string) {
    const t = note.trim().slice(0, 80)
    const { error } = t
      ? await supabase.from('batch_notes').upsert({ batch_id: id, note: t, updated_at: new Date().toISOString() })
      : await supabase.from('batch_notes').delete().eq('batch_id', id)
    if (error) return setErr(friendlyError(error, 'save the label'))
    setNotes((n) => {
      const { [id]: _, ...rest } = n
      return t ? { ...rest, [id]: t } : rest
    })
  }
  useEffect(() => void load(), [load])

  async function create(e: FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.rpc('create_batch', { p_name: name.trim(), p_place: place.trim() })
    setBusy(false)
    if (error) return setErr(friendlyError(error, 'create the batch'))
    if (label.trim()) await saveNote(data as string, label)
    setName('')
    setPlace('')
    setLabel('')
    setOpen(data as string)
    void load()
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      {err && <p className="note-err" role="alert">{err}</p>}
      <section className="card stack">
        <h2 className="section-title" style={{ margin: 0 }}>New batch</h2>
        <p className="small muted">
          For another class. Give it the name its students should see (e.g. L1 2026); keep your own notes in the private label. Create it, then add its class list with a <b>Role</b> column marking at least one <b>admin</b>
          (their lecturer or class rep) and any group <b>leaders</b>. Students then sign up with their index number as usual, and that admin
          runs the batch from their own Admin tab.
        </p>
        <form className="stack" style={{ gap: 8 }} onSubmit={create}>
          <input className="input" placeholder="Batch name, e.g. L1 2027" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
          <input className="input" placeholder="Field visit place, e.g. Kandy (optional)" value={place} maxLength={80} onChange={(e) => setPlace(e.target.value)} />
          <input className="input" placeholder="Private label only you see, e.g. Juniors (optional)" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
          <p className="tiny muted">Students see the batch name and place. The private label is never shown to them.</p>
          <button className="btn btn-lime" disabled={busy || name.trim().length < 2}>{busy ? 'Creating…' : 'Create batch'}</button>
        </form>
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <h2 className="section-title" style={{ margin: 0 }}>All batches</h2>
        {!rows && <p className="small muted">Loading…</p>}
        {rows?.length === 0 && !err && <p className="small muted">No batches yet.</p>}
        {rows?.map((b) => (
          <div key={b.id} className="card stack" style={{ gap: 8 }}>
            <div className="row between">
              <div>
                <b>{b.name}</b>{notes[b.id] && <span className="chip-private" title="Only you see this label"> 🔒 {notes[b.id]}</span>}
                <p className="small muted">{b.place ?? 'No place set'} · since {new Date(b.created_at).toLocaleDateString()}</p>
              </div>
              <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { const v = prompt('Private label (only you see it). Leave empty to remove.', notes[b.id] ?? ''); if (v !== null) void saveNote(b.id, v) }}>Label</button>
              <button className="btn btn-ghost btn-sm" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
                {open === b.id ? 'Close' : 'Class list'}
              </button>
              </div>
            </div>
            <div className="stat-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div><b>{b.students}</b><span>Students</span></div>
              <div><b>{b.joined}</b><span>Joined</span></div>
              <div><b>{b.leaders}</b><span>Leaders</span></div>
              <div><b>{b.admins}</b><span>Admins</span></div>
            </div>
            {b.admins === 0 && <p className="small" style={{ color: 'var(--danger)' }}>No admin yet: add a class list with someone's Role set to "admin".</p>}
            {open === b.id && <RosterUpload batchId={b.id} batchName={b.name} onDone={() => void load()} />}
          </div>
        ))}
      </section>
    </div>
  )
}
