import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { groupColor, GROUP_COLORS } from '../lib/geo'
import { nameOf, supabase, type TeamRow } from '../lib/supabase'

export default function Team() {
  const [rows, setRows] = useState<TeamRow[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [aiKey, setAiKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [q, setQ] = useState('')
  const [grp, setGrp] = useState('All')

  const load = useCallback(async () => {
    const { data } = await supabase.from('team_status').select('*').order('grp').order('subgroup').order('full_name')
    if (data) setRows(data as TeamRow[])
  }, [])

  useEffect(() => {
    void load()
    void supabase.from('settings').select('*').single().then(({ data }) => {
      setName(data?.coordinator_name ?? '')
      setPhone(data?.coordinator_phone ?? '')
      setAiKey(data?.ai_key ?? '')
    })
  }, [load])

  async function approve(userId: string) {
    await supabase.from('members').update({ status: 'approved' }).eq('user_id', userId)
    void load()
  }

  async function unlink(r: TeamRow) {
    if (!confirm(`Unlink ${nameOf(r)} (${r.full_name}, ${r.index_no}) from their phone? They can then join again on a new phone. Data they already uploaded is kept.`)) return
    await supabase.from('members').delete().eq('user_id', r.user_id!)
    void load()
  }

  async function saveSettings(e: FormEvent) {
    e.preventDefault()
    await supabase.from('settings').update({ coordinator_name: name, coordinator_phone: phone, ai_key: aiKey.trim() || null, updated_at: new Date().toISOString() }).eq('id', 1)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const pending = rows.filter((r) => r.status === 'pending')
  const joined = rows.filter((r) => r.status === 'approved').length
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => (grp === 'All' || r.grp === grp) && (!needle || r.full_name.toLowerCase().includes(needle) || (r.nickname ?? '').toLowerCase().includes(needle) || r.index_no.toLowerCase().includes(needle)))
  }, [rows, q, grp])

  return (
    <div className="stack" style={{ gap: 18 }}>
      <form className="card stack" onSubmit={saveSettings}>
        <h2 className="section-title" style={{ margin: 0 }}>Emergency contact</h2>
        <p className="small muted">Students see this when an SOS can't reach the server, as an SMS and call button. Use a phone that is with you in the field.</p>
        <input className="input" placeholder="Name, e.g. Admin" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input tnum" placeholder="+94 7X XXX XXXX" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <h2 className="section-title" style={{ margin: '8px 0 0' }}>Class AI key (optional)</h2>
        <p className="small muted">Used for open-interview follow-ups by students who haven't added their own key. One free key is shared by everyone, so it can run out at busy moments; students' own keys are better.</p>
        <input className="input" type="password" autoComplete="off" placeholder="Gemini key from aistudio.google.com/apikey" value={aiKey} onChange={(e) => setAiKey(e.target.value)} />
        <button className="btn btn-primary">{saved ? 'Saved' : 'Save settings'}</button>
      </form>

      {pending.length > 0 && (
        <section className="card stack">
          <h2 className="section-title" style={{ margin: 0 }}>Waiting for approval · {pending.length}</h2>
          <p className="small muted">Their name didn't match the class list. Approve only if you know it's them.</p>
          {pending.map((r) => (
            <div key={r.user_id} className="list-row">
              <div className="grow">
                <b>{nameOf(r)}</b>
                <p className="small muted tnum">{r.full_name} · {r.index_no}{r.email ? ` · ${r.email}` : ''}</p>
              </div>
              <button className="btn btn-lime btn-sm" onClick={() => void approve(r.user_id!)}>Approve</button>
              <button className="btn btn-ghost btn-sm" onClick={() => void unlink(r)}>Reject</button>
            </div>
          ))}
        </section>
      )}

      <section className="stack" style={{ gap: 10 }}>
        <div className="row between">
          <h2 className="section-title" style={{ margin: 0 }}>Class list</h2>
          <span className="chip tnum">{joined}/{rows.length} joined</span>
        </div>
        <input className="input" type="search" placeholder="Search name or index" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="segmented" role="group" aria-label="Filter by group">
          {['All', ...Object.keys(GROUP_COLORS)].map((g) => (
            <button key={g} aria-pressed={grp === g} onClick={() => setGrp(g)}>{g.replace('Group ', 'G')}</button>
          ))}
        </div>
        <div className="people">
          {shown.map((r) => (
            <div key={r.index_no} className="person-row">
              <span className="dot" style={{ background: groupColor(r.grp), width: 10, height: 10 }} />
              <div className="grow">
                <b>{nameOf(r)}</b>
                <p className="small muted tnum">{r.full_name} · {r.index_no} · {r.grp.replace('Group ', 'G')} {r.subgroup} · {r.elective}</p>
              </div>
              {r.status === 'approved' ? (
                <button className="pill-btn" onClick={() => void unlink(r)} title="Unlink from their phone">Joined</button>
              ) : r.status === 'pending' ? (
                <span className="chip">Pending</span>
              ) : (
                <span className="chip chip-muted">Not joined</span>
              )}
            </div>
          ))}
          {shown.length === 0 && <p className="empty">No one matches.</p>}
        </div>
        <p className="small muted">Tap “Joined” to unlink a student who changed or reset their phone.</p>
      </section>
    </div>
  )
}
