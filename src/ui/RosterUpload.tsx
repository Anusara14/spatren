import { useRef, useState, type FormEvent } from 'react'
import { groupsOf } from '../lib/geo'
import { readRosterFile, type RosterParse } from '../lib/roster'
import { friendlyError, supabase } from '../lib/supabase'

interface Result {
  added: number
  updated: number
  clash: string[]
  invalid: string[]
}

/** Pick a class list (.xlsx or .csv), check it, then add it to a batch. Nothing is saved until "Add". */
export default function RosterUpload({ batchId, batchName, onDone }: { batchId: string; batchName: string; onDone?: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<(RosterParse & { file: string }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  async function pick(file: File | undefined) {
    if (!file) return
    setErr(null)
    setResult(null)
    try {
      setParsed({ ...(await readRosterFile(file)), file: file.name })
    } catch (e) {
      setParsed(null)
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      if (input.current) input.current.value = ''
    }
  }

  async function add() {
    if (!parsed?.rows.length) return
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.rpc('import_roster', { p_batch: batchId, p_rows: parsed.rows })
    setBusy(false)
    if (error) return setErr(friendlyError(error, 'add the class list'))
    setResult(data as Result)
    setParsed(null)
    onDone?.()
  }

  const groups = parsed ? groupsOf(parsed.rows) : []
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="small muted">
        Pick the class list as an Excel (.xlsx or .xls) or CSV file with columns like <b>Index No.</b>, <b>Name</b>, and optionally <b>Group</b>, <b>Topic</b>,{' '}
        <b>Elective</b> and <b>Role</b> (leader / admin). Merged Group and Topic cells are fine. Students already in the list are updated, never removed.
      </p>
      <input ref={input} type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      <button type="button" className="btn btn-ghost" onClick={() => input.current?.click()}>Choose class list…</button>
      <AddOne batchId={batchId} onAdded={(r) => { setResult(r); onDone?.() }} />

      {parsed && (
        <div className="card-flat stack" style={{ gap: 8 }}>
          <b>{parsed.file}</b>
          <p className="small">
            {parsed.rows.length} students · {groups.length ? `${groups.length} groups (${groups.join(', ')})` : 'no groups'} ·{' '}
            {parsed.rows.filter((r) => r.is_leader).length} leaders · {parsed.rows.filter((r) => r.is_admin).length} admins
          </p>
          <p className="tiny muted">
            Read columns: {Object.entries(parsed.columns).filter(([, v]) => v).map(([k, v]) => `${v} → ${k.replace('_', ' ')}`).join(' · ')}
          </p>
          {parsed.problems.length > 0 && (
            <details>
              <summary className="small" style={{ color: 'var(--danger)' }}>{parsed.problems.length} row{parsed.problems.length === 1 ? '' : 's'} skipped</summary>
              <ul className="tiny">{parsed.problems.slice(0, 30).map((p) => <li key={p}>{p}</li>)}</ul>
            </details>
          )}
          <div className="row">
            <button type="button" className="btn btn-ghost grow" onClick={() => setParsed(null)}>Cancel</button>
            <button type="button" className="btn btn-lime grow" disabled={busy || !parsed.rows.length} onClick={() => void add()}>
              {busy ? 'Adding…' : `Add ${parsed.rows.length} to ${batchName}`}
            </button>
          </div>
        </div>
      )}

      {result && (
        <p className="small" role="status">
          Added {result.added}, updated {result.updated}.
          {result.clash.length > 0 && ` ${result.clash.length} already belong to another batch and were skipped (${result.clash.slice(0, 5).join(', ')}${result.clash.length > 5 ? '…' : ''}).`}
          {result.invalid.length > 0 && ` ${result.invalid.length} had an invalid index.`}
        </p>
      )}
      {err && <p className="note-err" role="alert">{err}</p>}
    </div>
  )
}

/** No sheet? Add students one at a time (index, name, group, topic, elective, role). */
function AddOne({ batchId, onAdded }: { batchId: string; onAdded: (r: Result) => void }) {
  const [f, setF] = useState({ index_no: '', full_name: '', grp: '', subgroup: '', elective: '', role: 'student' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const index = f.index_no.replace(/\s/g, '').toUpperCase()
  const valid = /^[A-Z0-9]{3,20}$/.test(index) && f.full_name.trim().length > 0

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setErr(null)
    const row = {
      index_no: index, full_name: f.full_name.trim(), grp: f.grp.trim() || null, subgroup: f.subgroup.trim() || null, elective: f.elective.trim() || null,
      is_admin: f.role === 'admin', is_leader: f.role === 'leader',
    }
    const { data, error } = await supabase.rpc('import_roster', { p_batch: batchId, p_rows: [row] })
    setBusy(false)
    if (error) return setErr(friendlyError(error, 'add the student'))
    const r = data as Result
    if (r.clash.length) return setErr(`${index} is already in another batch.`)
    onAdded(r)
    setF({ ...f, index_no: '', full_name: '' }) // keep group/topic for the next classmate
  }

  return (
    <details className="card-flat">
      <summary className="small"><b>Add one student</b> (no sheet needed)</summary>
      <form className="stack" style={{ gap: 8, marginTop: 10 }} onSubmit={submit}>
        <div className="row" style={{ gap: 8 }}>
          <input className="input tnum" aria-label="Index number" placeholder="Index no., e.g. 251001A" value={f.index_no} maxLength={20} onChange={set('index_no')} required />
          <input className="input grow" aria-label="Full name" placeholder="Name, e.g. Perera A.B." value={f.full_name} maxLength={120} onChange={set('full_name')} required />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" aria-label="Group" placeholder="Group, e.g. Group 1" value={f.grp} maxLength={60} onChange={set('grp')} />
          <input className="input" aria-label="Topic or subgroup" placeholder="Topic (optional)" value={f.subgroup} maxLength={60} onChange={set('subgroup')} />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" aria-label="Elective" placeholder="Elective (optional)" value={f.elective} maxLength={60} onChange={set('elective')} />
          <select className="input" aria-label="Role" value={f.role} onChange={set('role')}>
            <option value="student">Student</option>
            <option value="leader">Group leader</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {err && <p className="note-err" role="alert">{err}</p>}
        <button className="btn btn-lime btn-sm" disabled={!valid || busy}>{busy ? 'Adding…' : 'Add student'}</button>
      </form>
    </details>
  )
}
