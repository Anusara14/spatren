import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { myBatch, saveBatch } from '../lib/batch'
import { groupColor, groupsOf } from '../lib/geo'
import { friendlyError, nameOf, supabase, type Profile, type TeamRow } from '../lib/supabase'
import PendingPanel from './PendingPanel'
import RosterUpload from './RosterUpload'

/** Admin → People: this batch's emergency contact and AI key, join approvals, class list, leaders and admins. */
export default function Team({ profile }: { profile: Profile }) {
  const [rows, setRows] = useState<TeamRow[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [aiKey, setAiKey] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [grp, setGrp] = useState('All')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const batchId = profile.batch_id ?? null

  const load = useCallback(async () => {
    let query = supabase.from('team_status').select('*').order('grp').order('subgroup').order('full_name')
    if (batchId) query = query.eq('batch_id', batchId) // the platform owner can read every batch's roster; show only this one here
    const { data, error } = await query
    if (error) return setErr(friendlyError(error, 'load the class list'))
    setRows((data ?? []) as TeamRow[])
  }, [batchId])

  useEffect(() => {
    void load()
    void myBatch().then((b) => {
      setName(b?.coordinator_name ?? '')
      setPhone(b?.coordinator_phone ?? '')
      setAiKey(b?.ai_key ?? '')
    })
  }, [load])

  async function unlink(r: TeamRow) {
    if (!confirm(`Unlink ${nameOf(r)} (${r.full_name}, ${r.index_no}) from their phone? They can then join again on a new phone. Data they already uploaded is kept.`)) return
    const { error } = await supabase.from('members').delete().eq('user_id', r.user_id!)
    if (error) setErr(error.message)
    void load()
  }

  async function setRole(r: TeamRow, leader: boolean | null, admin: boolean | null) {
    setBusy(r.index_no)
    setErr(null)
    const { error } = await supabase.rpc('set_roles', { p_index: r.index_no, p_leader: leader, p_admin: admin })
    setBusy(null)
    if (error) return setErr(friendlyError(error, 'change that role'))
    setRows((all) => all.map((x) => (x.index_no === r.index_no ? { ...x, is_leader: leader ?? x.is_leader, is_admin: admin ?? x.is_admin } : x)))
  }

  async function saveSettings(e: FormEvent) {
    e.preventDefault()
    if (!batchId) return setSaved('No batch')
    const problem = await saveBatch(batchId, { coordinator_name: name.trim() || null, coordinator_phone: phone.trim() || null, ai_key: aiKey.trim() || null })
    if (problem) return setErr(`Couldn't save: ${problem}`)
    setSaved('Saved')
    setTimeout(() => setSaved(null), 2000)
  }

  const groups = useMemo(() => groupsOf(rows), [rows])
  const joined = rows.filter((r) => r.status === 'approved').length
  const leaders = rows.filter((r) => r.is_leader)
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (grp === 'All' || (grp === 'Leaders' ? r.is_leader : r.grp === grp)) &&
        (!needle || r.full_name.toLowerCase().includes(needle) || (r.nickname ?? '').toLowerCase().includes(needle) || r.index_no.toLowerCase().includes(needle)),
    )
  }, [rows, q, grp])
  const short = (g: string | null) => (g ?? '').replace(/^Group\s*/i, 'G')

  return (
    <div className="stack" style={{ gap: 18 }}>
      {err && <p className="note-err" role="alert">{err}</p>}
      <PendingPanel scope="batch" />
      <form className="card stack" onSubmit={saveSettings}>
        <h2 className="section-title" style={{ margin: 0 }}>Emergency contact</h2>
        <p className="small muted">Students in {profile.batch_name ?? 'this batch'} see this when an SOS can't reach the server, as an SMS and call button. Use a phone that is with you in the field.</p>
        <input className="input" placeholder="Name, e.g. Admin" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <input className="input tnum" placeholder="+94 7X XXX XXXX" inputMode="tel" value={phone} maxLength={30} onChange={(e) => setPhone(e.target.value)} />
        <h2 className="section-title" style={{ margin: '8px 0 0' }}>Class AI key (optional)</h2>
        <p className="small muted">Used for open-interview follow-ups by students who haven't added their own key. One free key is shared by everyone, so it can run out at busy moments; students' own keys are better.</p>
        <input className="input" type="password" autoComplete="off" placeholder="Gemini key from aistudio.google.com/apikey" value={aiKey} maxLength={200} onChange={(e) => setAiKey(e.target.value)} />
        <button className="btn btn-primary">{saved ?? 'Save settings'}</button>
      </form>

      <section className="stack" style={{ gap: 10 }}>
        <div className="row between">
          <h2 className="section-title" style={{ margin: 0 }}>Class list</h2>
          <span className="chip tnum">{joined}/{rows.length} joined · {leaders.length} leader{leaders.length === 1 ? '' : 's'}</span>
        </div>
        <input className="input" type="search" placeholder="Search name or index" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="segmented seg-scroll" role="group" aria-label="Filter">
          {['All', ...groups, 'Leaders'].map((g) => (
            <button key={g} aria-pressed={grp === g} onClick={() => setGrp(g)}>{g === 'All' || g === 'Leaders' ? g : short(g)}</button>
          ))}
        </div>
        <div className="people">
          {shown.map((r) => (
            <div key={r.index_no} className="person-row">
              <span className="dot" style={{ background: groupColor(r.grp), width: 10, height: 10 }} />
              <div className="grow">
                <b>{nameOf(r)} {r.is_leader && <span className="role-tag">Leader</span>} {r.is_admin && <span className="role-tag admin">Admin</span>}</b>
                <p className="small muted tnum">{r.full_name} · {r.index_no}{r.grp ? ` · ${short(r.grp)}` : ''}{r.subgroup ? ` ${r.subgroup}` : ''}{r.elective ? ` · ${r.elective}` : ''}</p>
              </div>
              <button
                className={`pill-btn ${r.is_leader ? 'on' : ''}`}
                disabled={busy === r.index_no}
                aria-pressed={!!r.is_leader}
                title={r.is_leader ? 'Remove as group leader' : `Make group leader of ${r.grp ?? 'their group'}`}
                onClick={() => void setRole(r, !r.is_leader, null)}
              >
                {r.is_leader ? '★ Leader' : '☆ Leader'}
              </button>
              {r.status === 'approved' ? (
                <button className="pill-btn" onClick={() => void unlink(r)} title="Unlink from their phone">Joined</button>
              ) : r.status === 'pending' ? (
                <span className="chip">Pending</span>
              ) : (
                <span className="chip chip-muted">Not joined</span>
              )}
            </div>
          ))}
          {shown.length === 0 && <p className="empty">{rows.length ? 'No one matches.' : 'No students yet. Upload the class list below.'}</p>}
        </div>
        <p className="small muted">
          Group leaders get SOS alerts from their group and can call their group to a meeting pin. Tap “Joined” to unlink a student who changed or reset their phone.
        </p>
      </section>

      {batchId && (
        <section className="card stack">
          <h2 className="section-title" style={{ margin: 0 }}>Add or update students</h2>
          <RosterUpload batchId={batchId} batchName={profile.batch_name ?? 'this batch'} onDone={() => void load()} />
        </section>
      )}

      {profile.is_admin && (
        <details className="card">
          <summary className="small">Make someone else an admin</summary>
          <p className="small muted" style={{ marginTop: 8 }}>Admins see everyone in the batch, manage forms and approve students.</p>
          <div className="people" style={{ marginTop: 8 }}>
            {rows.filter((r) => r.status === 'approved' && r.user_id).map((r) => (
              <div key={r.index_no} className="person-row">
                <div className="grow"><b>{nameOf(r)}</b><p className="small muted tnum">{r.index_no}</p></div>
                <button className={`pill-btn ${r.is_admin ? 'on' : ''}`} disabled={busy === r.index_no} aria-pressed={!!r.is_admin} onClick={() => void setRole(r, null, !r.is_admin)}>
                  {r.is_admin ? 'Admin' : 'Make admin'}
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
