import { useState } from 'react'
import { ago } from '../lib/geo'
import { usePendingMembers, type Pending } from '../lib/pending'

/** Sign-ups waiting for approval, newest last, with Approve / Not them and Approve all. Hidden when nobody waits. */
export default function PendingPanel({ scope }: { scope: 'batch' | 'group' }) {
  const { list, error, decide, approveAll } = usePendingMembers(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function run(key: string, job: () => Promise<string | null>) {
    setBusy(key)
    setMsg(await job())
    setBusy(null)
  }
  const one = (p: Pending, approve: boolean) => {
    if (!approve && !confirm(`Turn away ${p.nickname || p.full_name} (${p.index_no})? They can sign up again with the right name.`)) return
    void run(p.user_id, () => decide(p, approve))
  }

  if (!list.length && !error) return null
  return (
    <section className="card stack pending-panel" aria-label="Waiting to join">
      <div className="row between">
        <h2 className="section-title" style={{ margin: 0 }}>Waiting to join · {list.length}</h2>
        {list.length > 1 && (
          <button className="btn btn-lime btn-sm" disabled={!!busy} onClick={() => void run('all', approveAll)}>{busy === 'all' ? 'Approving…' : 'Approve all'}</button>
        )}
      </div>
      <p className="small muted">
        Their typed name didn't match the class list{scope === 'group' ? ' for your group' : ''}. Approve if the index and name below are really them.
      </p>
      {list.map((p) => (
        <div key={p.user_id} className="list-row">
          <div className="grow" style={{ minWidth: 0 }}>
            <b>{p.nickname || p.full_name}</b>
            <p className="small muted tnum">
              {p.full_name} · {p.index_no}{p.grp ? ` · ${p.grp}` : ''}{p.email && !p.email.endsWith('@students.spatren.app') ? ` · ${p.email}` : ''}
              {p.claimed_at ? ` · ${ago(p.claimed_at)}` : ''}
            </p>
          </div>
          <button className="btn btn-lime btn-sm" disabled={!!busy} onClick={() => one(p, true)}>{busy === p.user_id ? '…' : 'Approve'}</button>
          <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => one(p, false)}>Not them</button>
        </div>
      ))}
      {(msg || error) && <p className="note-err" role="alert">{msg ?? error}</p>}
    </section>
  )
}

/** Count bubble for the Admin tab, so waiting sign-ups are noticed. */
export function PendingBadge() {
  const { list } = usePendingMembers(true)
  return list.length ? <span className="tab-badge" aria-label={`${list.length} waiting to join`}>{list.length}</span> : null
}
